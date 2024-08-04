package warp

import (
	"github.com/TugasAkhir-QUIC/webtransport-go"
	"sync"
)

type SendDatagram struct {
	inner     *webtransport.Session
	ID        uint16
	fragments []Fragment

	err error

	notify chan struct{}
	mutex  sync.Mutex
}

type Fragment struct {
	bytes       []byte
	ID          uint16
	chunkNumber uint8
	priority    int
}

func newSendDatagram(inner *webtransport.Session) (sd *SendDatagram) {
	sd = new(SendDatagram)
	sd.inner = inner
	sd.ID = 0
	return sd
}

func (sd *SendDatagram) getID() uint16 {
	sd.mutex.Lock()
	defer sd.mutex.Unlock()
	ID := sd.ID
	sd.ID++
	return ID
}

//func (sd *SendDatagram) Run(ctx context.Context) (err error) {
//	defer func() {
//		d.mutex.Lock()
//		d.err = err
//		d.mutex.Unlock()
//	}()
//
//	for {
//		d.mutex.Lock()
//
//		chunks := d.chunks
//		notify := d.notify
//		//closed := d.closed
//
//		d.chunks = d.chunks[len(d.chunks):]
//		d.mutex.Unlock()
//
//		//if len(chunks) != 0 {
//		//	fmt.Println(len(chunks))
//		//}
//		for _, chunk := range chunks {
//			chunkLength := len(chunk)
//			totalFragments := chunkLength / d.maxSize
//			if chunkLength%d.maxSize != 0 {
//				totalFragments++
//			}
//			// TODO: make sure totalFragments <  65,535
//			for i := 0; i < totalFragments; i++ {
//				start := i * d.maxSize
//				var end int
//				if i == totalFragments-1 && chunkLength%d.maxSize != 0 {
//					end = start + chunkLength%d.maxSize
//				} else {
//					end = start + d.maxSize
//				}
//
//				header := d.generateHeader(uint16(i), uint16(totalFragments))
//				err := d.inner.SendDatagram(append(header, chunk[start:end]...))
//				//fmt.Println("SENDING DATAGRAM", d.chunkNumber, d.ID)
//				if err != nil {
//					return err
//				}
//			}
//			d.chunkNumber++
//		}
//
//		//if closed {
//		//	return nil
//		//}
//
//		if len(chunks) == 0 {
//			select {
//			case <-ctx.Done():
//				return ctx.Err()
//			case <-notify:
//			}
//		}
//	}
//}
//
//func (sd *SendDatagram) SendDatagram(fragment Fragment) (n int, err error) {
//	sd.mutex.Lock()
//	defer sd.mutex.Unlock()
//
//	if sd.err != nil {
//		return 0, d.err
//	}
//
//	// Make a copy of the buffer so it's long lived
//	buf = append([]byte{}, buf...)
//	sd.chunks = append(sd.chunks, buf)
//
//	// Wake up the writer
//	close(sd.notify)
//	sd.notify = make(chan struct{})
//
//	return len(buf), nil
//}
