package warp

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/TugasAkhir-QUIC/webtransport-go"
)

// Wrapper around quic.SendStream to make Write non-blocking.
// Otherwise we can't write to multiple concurrent streams in the same goroutine.
type Datagram struct {
	inner *webtransport.Session
	// TODO: Add support for datagram

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

func (d *Datagram) WriteMessage(msg Message) (err error) {
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
