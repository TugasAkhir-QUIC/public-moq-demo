package warp

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/TugasAkhir-QUIC/webtransport-go"
	"sync/atomic"
)

// TODO: mulai dari awal untuk setiap koneksi
var idCounter int32 = -1

// Wrapper around webtransport.Session to make Write non-blocking.
// Otherwise we can't write to multiple concurrent streams in the same goroutine.
type Datagram struct {
	inner       *webtransport.Session
	ID          uint16
	chunkNumber uint8
	maxSize     int

	chunks [][]byte
}

func NewDatagram(inner *webtransport.Session) (d *Datagram) {
	d = new(Datagram)
	d.ID = uint16(atomic.AddInt32(&idCounter, 1) % 65536)
	d.chunkNumber = 0
	d.inner = inner
	d.maxSize = 1408 // // gatau kenapa skip 2 detik diawal kalau segini
	// diatas 1415 (1392 + header(23)), diterima client sudah dipotong2
	// cek const MaxPacketBufferSize = 1452 di quic-go
	return d
}

//func (d *Datagram) Write(buf []byte) (m int, err error) {
//	chunkLength := len(buf)
//	totalFragments := chunkLength / d.maxSize
//	if totalFragments == 0 {
//		header := d.generateHeader(uint16(0), uint16(1))
//		err = d.inner.SendDatagram(append(header, buf...))
//		if err != nil {
//			return 0, err
//		}
//		d.chunkNumber++
//		return chunkLength, nil
//	}
//	totalFragments++
//	// TODO: make sure totalFragments <  65,535
//	for i := 0; i < totalFragments; i++ {
//		start := i * d.maxSize
//		var end int
//		if i == totalFragments-1 {
//			end = start + chunkLength%d.maxSize
//		} else {
//			end = start + d.maxSize
//		}
//
//		header := d.generateHeader(uint16(i), uint16(totalFragments))
//		err := d.inner.SendDatagram(append(header, buf[start:end]...))
//		if err != nil {
//			return len(buf[:start]), err
//		}
//	}
//	d.chunkNumber++
//
//	return chunkLength, nil
//}

func (d *Datagram) Write(buf []byte) (n int, err error) {
	chunkLength := len(buf)
	totalFragments := chunkLength / d.maxSize
	if chunkLength%d.maxSize != 0 {
		totalFragments++
	}
	// TODO: make sure totalFragments <  65,535
	for i := 0; i < totalFragments; i++ {
		start := i * d.maxSize
		var end int
		if i == totalFragments-1 && chunkLength%d.maxSize != 0 {
			end = start + chunkLength%d.maxSize
		} else {
			end = start + d.maxSize
		}

		header := d.generateHeader(uint16(i), uint16(totalFragments))
		err := d.inner.SendDatagram(append(header, buf[start:end]...))
		if err != nil {
			return len(buf[:start]), err
		}
	}
	d.chunkNumber++

	return len(buf), nil
}

func (d *Datagram) generateHeader(fragmentNumber uint16, fragmentTotal uint16) []byte {
	var segmentIdBuffer [2]byte
	binary.BigEndian.PutUint16(segmentIdBuffer[:], d.ID)
	var fragmentNumberBuffer [2]byte
	binary.BigEndian.PutUint16(fragmentNumberBuffer[:], fragmentNumber)
	var fragmentTotalBuffer [2]byte
	binary.BigEndian.PutUint16(fragmentTotalBuffer[:], fragmentTotal)

	var header []byte
	header = append(header, segmentIdBuffer[:]...)
	header = append(header, d.chunkNumber)
	header = append(header, fragmentNumberBuffer[:]...)
	header = append(header, fragmentTotalBuffer[:]...)
	return header
}

func (d *Datagram) WriteMessage(msg Message) (err error) {
	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	var msgByte []byte

	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(payload)+8))

	msgByte = append(msgByte, size[:]...)
	msgByte = append(msgByte, []byte("warp")...)
	msgByte = append(msgByte, payload...)

	if len(msgByte) > d.maxSize {
		return fmt.Errorf("message that is bigger than %d bytes is not yet supported", d.maxSize) // It will be splitted if the size is more than 15000
	}
	_, err = d.Write(msgByte)
	if err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}

	return nil
}

func (d *Datagram) Close() (err error) {
	var segmentIdBuffer [2]byte
	binary.BigEndian.PutUint16(segmentIdBuffer[:], d.ID)

	payload := append(segmentIdBuffer[:], d.chunkNumber)

	var msgByte []byte

	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(payload)+8))

	msgByte = append(msgByte, size[:]...)
	msgByte = append(msgByte, []byte("finw")...)
	msgByte = append(msgByte, payload...)

	if len(msgByte) > d.maxSize {
		return fmt.Errorf("message that is bigger than %d bytes is not yet supported", d.maxSize) // It will be splitted if the size is more than 15000
	}

	_, err = d.Write(msgByte)
	if err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}

	return nil
}
