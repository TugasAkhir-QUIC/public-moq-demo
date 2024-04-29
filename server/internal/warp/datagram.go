package warp

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/TugasAkhir-QUIC/webtransport-go"
	"sync"
)

const (
	isSegment  = byte(1)
	notSegment = byte(0)
	maxSize    = 1100 // more than 1300, the client won't pick it up
)

// Wrapper around webtransport.Session to make Write non-blocking.
// Otherwise we can't write to multiple concurrent streams in the same goroutine.
type Datagram struct {
	inner *webtransport.Session

	chunks [][]byte
	closed bool
	err    error

	notify chan struct{}
	mutex  sync.Mutex
}

func NewDatagram(inner *webtransport.Session) (d *Datagram) {
	d = new(Datagram)
	d.inner = inner
	d.notify = make(chan struct{})
	return d
}

func (d *Datagram) Run(ctx context.Context) (err error) {
	defer func() {
		d.mutex.Lock()
		d.err = err
		d.mutex.Unlock()
	}()

	for {
		d.mutex.Lock()

		chunks := d.chunks
		notify := d.notify
		//closed := d.closed

		d.chunks = d.chunks[len(d.chunks):]
		d.mutex.Unlock()

		for _, chunk := range chunks {
			err = d.inner.SendDatagram(chunk)
			if err != nil {
				return err
			}
		}

		//if closed {
		//	return d.inner.Close()
		//}

		if len(chunks) == 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-notify:
			}
		}
	}
}

// WriteSegment [isSegment][isInit][segmentID][chunkID][fragmentNumber][fragmentTotal]
func (d *Datagram) WriteSegment(buf []byte, isInit int, segmentId string, chunkId string) (err error) {
	chunkLength := int64(len(buf))
	n := int(chunkLength / maxSize)
	if n == 0 {
		var fragmentNumberBuffer [2]byte
		var fragmentTotalBuffer [2]byte
		binary.BigEndian.PutUint16(fragmentNumberBuffer[:], uint16(0))
		binary.BigEndian.PutUint16(fragmentTotalBuffer[:], uint16(1))
		var headerF []byte
		headerF = append(headerF, isSegment)

		headerF = append(headerF, byte(isInit))
		headerF = append(headerF, []byte(segmentId)...)
		headerF = append(headerF, []byte(chunkId)...)
		headerF = append(headerF, fragmentNumberBuffer[:]...)
		headerF = append(headerF, fragmentTotalBuffer[:]...)

		_, err = d.Write(append(headerF, buf...))
		if err != nil {
			return err
		}
		return nil
	}
	totalFragments := n
	if chunkLength%maxSize != 0 {
		totalFragments += 1
	}
	var fragmentTotalBuffer [2]byte
	binary.BigEndian.PutUint16(fragmentTotalBuffer[:], uint16(totalFragments))
	// TODO: make sure totalFragments <  65,535
	// split chunk
	for i := 0; i < totalFragments; i++ {
		start := i * maxSize
		var end int
		if i == n {
			end = start + int(chunkLength%maxSize)
		} else {
			end = start + maxSize
		}

		var fragmentNumberBuffer [2]byte
		binary.BigEndian.PutUint16(fragmentNumberBuffer[:], uint16(i))
		var headerF []byte
		headerF = append(headerF, isSegment)

		headerF = append(headerF, byte(isInit))
		headerF = append(headerF, []byte(segmentId)...)
		headerF = append(headerF, []byte(chunkId)...)
		headerF = append(headerF, fragmentNumberBuffer[:]...)
		headerF = append(headerF, fragmentTotalBuffer[:]...)

		_, err = d.Write(append(headerF, buf[start:end]...))
		if err != nil {
			return err
		}
	}

	return nil
}

func (d *Datagram) Write(buf []byte) (n int, err error) {
	d.mutex.Lock()
	defer d.mutex.Unlock()

	if d.err != nil {
		return 0, d.err
	}

	if d.closed {
		return 0, fmt.Errorf("closed")
	}

	// Make a copy of the buffer so it'd long lived
	buf = append([]byte{}, buf...)
	d.chunks = append(d.chunks, buf)

	// Wake up the writer
	close(d.notify)
	d.notify = make(chan struct{})

	return len(buf), nil
}

// WriteMessageSegment [isSegment][isInit][segmentID][chunkID][fragmentNumber][fragmentTotal]
func (d *Datagram) WriteMessageSegment(msg Message, isInit int, segmentId string, chunkId string) (err error) {
	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	var msgByte []byte
	msgByte = append(msgByte, isSegment)

	var fragmentNumberBuffer [2]byte
	var fragmentTotalBuffer [2]byte
	binary.BigEndian.PutUint16(fragmentNumberBuffer[:], uint16(0))
	binary.BigEndian.PutUint16(fragmentTotalBuffer[:], uint16(1))

	msgByte = append(msgByte, byte(isInit))
	msgByte = append(msgByte, []byte(segmentId)...)
	msgByte = append(msgByte, []byte(chunkId)...)
	msgByte = append(msgByte, fragmentNumberBuffer[:]...)
	msgByte = append(msgByte, fragmentTotalBuffer[:]...)

	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(payload)+8))

	msgByte = append(msgByte, size[:]...)
	msgByte = append(msgByte, []byte("warp")...)
	msgByte = append(msgByte, payload...)
	_, err = d.Write(msgByte)
	if err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}

	return nil
}

func (d *Datagram) WriteMessage(msg Message, raw []byte) (err error) {
	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	var msgByte []byte
	msgByte = append(msgByte, notSegment)

	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(payload)+8))

	msgByte = append(msgByte, size[:]...)
	msgByte = append(msgByte, []byte("warp")...)
	msgByte = append(msgByte, payload...)
	if raw != nil {
		msgByte = append(msgByte, raw...)
	}
	if len(msgByte) > 14999 {
		return fmt.Errorf("init message that is bigger than 15000 bytes is not yet supported") // It will be splitted if the size is more than 15000
	}
	_, err = d.Write(msgByte)
	if err != nil {
		return fmt.Errorf("failed to write message: %w", err)
	}

	return nil
}

//func (s *Datagram) WriteCancel(code webtransport.StreamErrorCode) {
//	s.inner.CancelWrite(code)
//}
//
//func (s *Datagram) SetPriority(prio int) {
//	s.inner.SetPriority(prio)
//}

func (d *Datagram) Close() (err error) {
	d.mutex.Lock()
	defer d.mutex.Unlock()

	if d.err != nil {
		return d.err
	}

	d.closed = true

	// Wake up the writer
	close(d.notify)
	d.notify = make(chan struct{})

	return nil
}
