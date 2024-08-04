package warp

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/TugasAkhir-QUIC/webtransport-go"
	"sync"
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
	closed bool
	err    error

	notify      chan struct{}
	delayNotify chan struct{}
	isDelayed   bool
	mutex       sync.Mutex
}

func NewDatagram(inner *webtransport.Session) (d *Datagram) {
	d = new(Datagram)
	d.ID = uint16(atomic.AddInt32(&idCounter, 1) % 65536)
	d.chunkNumber = 0
	d.inner = inner
	d.maxSize = 1250 // // gatau kenapa skip 2 detik diawal kalau segini
	// diatas 1415 (1392 + header(23)), diterima client sudah dipotong2
	// cek const MaxPacketBufferSize = 1452 di quic-go
	d.notify = make(chan struct{})
	d.delayNotify = make(chan struct{})
	d.isDelayed = false
	return d
}

func (d *Datagram) Run(ctx context.Context) (err error) {
	defer func() {
		d.mutex.Lock()
		d.err = err
		d.mutex.Unlock()
	}()

	if d.isDelayed {
		<-d.delayNotify
	}

	for {
		d.mutex.Lock()

		chunks := d.chunks
		notify := d.notify
		closed := d.closed

		d.chunks = d.chunks[len(d.chunks):]
		d.mutex.Unlock()

		//if len(chunks) != 0 {
		//	fmt.Println(len(chunks))
		//}
		if closed {
			return err
		}

		for _, chunk := range chunks {
			chunkLength := len(chunk)
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
				err := d.inner.SendDatagram(append(header, chunk[start:end]...))
				//fmt.Println("SENDING DATAGRAM", d.chunkNumber, d.ID)
				if err != nil {
					return err
				}
			}
			d.chunkNumber++
		}

		if len(chunks) == 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-notify:
			}
		}
	}
}

func (d *Datagram) Write(buf []byte) (n int, err error) {
	d.mutex.Lock()
	defer d.mutex.Unlock()

	if d.err != nil {
		return 0, d.err
	}

	// Make a copy of the buffer so it's long lived
	buf = append([]byte{}, buf...)
	d.chunks = append(d.chunks, buf)

	// Wake up the writer
	close(d.notify)
	d.notify = make(chan struct{})

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

	d.mutex.Lock()
	defer d.mutex.Unlock()

	d.closed = true

	// Wake up the writer
	close(d.notify)
	d.notify = make(chan struct{})

	return nil
}
