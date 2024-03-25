package warp

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"sync"

	"github.com/TugasAkhir-QUIC/webtransport-go"
)

const (
	segmentData    = byte(1)
	notSegmentData = byte(0)
	fragmented     = byte(1)
	notFragmented  = byte(0)
	maxSize        = 1100
)

// Wrapper around quic.SendStream to make Write non-blocking.
// Otherwise we can't write to multiple concurrent streams in the same goroutine.
type Datagram struct {
	inner *webtransport.Session

	chunks [][]byte
	closed bool
	err    error

	notify chan struct{}
	mutex  sync.Mutex

	ID     string
	initID string
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
			//if len(chunk) > 15000 {
			//	continue
			//}
			//err = d.inner.SendDatagram(chunk)
			chunkLength := int64(len(chunk))
			//fmt.Println(chunkLength)
			n := int(chunkLength / maxSize)
			if n == 0 {
				err = d.inner.SendDatagram(append([]byte{notFragmented}, chunk...)) // TODO: Seharusnya Write
				if err != nil {
					return err
				}
				continue
			}
			id := uuid.New().String()[:8]
			totalFragments := n
			if chunkLength%maxSize != 0 {
				totalFragments += 1
			}
			// split chunk
			for i := 0; i < totalFragments; i++ {
				start := i * maxSize
				var end int
				if i == n {
					end = start + int(chunkLength%maxSize)
					//fmt.Print("end: ")
					//fmt.Println(end)
				} else {
					end = start + maxSize
				}

				var header []byte
				header = append(header, fragmented)
				header = append(header, []byte(id)...)
				header = append(header, byte(i))
				header = append(header, byte(totalFragments))
				err = d.inner.SendDatagram(append(header, chunk[start:end]...))
				if err != nil {
					fmt.Println(err)
					return err
				}
				//fmt.Println(id, []byte(id), totalFragments, chunkLength, byte(i), len(chunk[start:end]))
			}
		}
		//if len(chunks) != 0 {
		//	fmt.Println(len(chunks))
		//	msg := make([]byte, 0)
		//	for _, chunk := range chunks {
		//		msg = append(msg, chunk...)
		//	}
		//	err = d.inner.SendDatagram(msg) // TODO: Seharusnya Write
		//	if err != nil {
		//		return err
		//	}
		//}

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

func (d *Datagram) WriteSegment(buf []byte, lastSegment int) (n int, err error) {
	d.mutex.Lock()
	defer d.mutex.Unlock()

	if d.err != nil {
		return 0, d.err
	}

	if d.closed {
		return 0, fmt.Errorf("closed")
	}

	// Make a copy of the buffer so it'd long lived
	var header []byte
	header = append(header, segmentData)
	header = append(header, byte(lastSegment))
	header = append(header, []byte(d.ID)...)
	header = append(header, []byte(d.initID)...)
	buf = append(header, buf...)
	d.chunks = append(d.chunks, buf)

	// Wake up the writer
	close(d.notify)
	d.notify = make(chan struct{})

	return len(buf), nil
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

func (d *Datagram) WriteMessageDeprecated(msg Message) (err error) {
	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(payload)+8))

	_, err = d.Write(size[:])
	if err != nil {
		return fmt.Errorf("failed to write size: %w", err)
	}

	_, err = d.Write([]byte("warp"))
	if err != nil {
		return fmt.Errorf("failed to write atom header: %w", err)
	}

	_, err = d.Write(payload)
	if err != nil {
		return fmt.Errorf("failed to write payload: %w", err)
	}

	return nil
}

func (d *Datagram) WriteMessage(msg Message, raw []byte) (err error) {
	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("failed to marshal message: %w", err)
	}

	var size [4]byte
	binary.BigEndian.PutUint32(size[:], uint32(len(payload)+8))

	var msgByte []byte
	//msgByte = append(msgByte, notSegmentData)
	msgByte = append(msgByte, size[:]...)
	msgByte = append(msgByte, []byte("warp")...)
	msgByte = append(msgByte, payload...)
	if raw != nil {
		msgByte = append(msgByte, raw...)
	}
	if len(msgByte) > 14999 {
		return fmt.Errorf("init message that is bigger than 15000 bytes is not yet supported") // It will be splitted if the size is more than 15000
	}
	_, err = d.Write(append([]byte{notSegmentData}, msgByte...))
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
