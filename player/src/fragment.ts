import { Player } from "./player";

type MessageFragment = {
    isInit: boolean;
    segmentID: string;
    chunkID: string;
    fragmentNumber: number;
    fragmentTotal: number;
    data: Uint8Array;
};

export class FragmentedMessageHandler {
    private segmentStreams: Map<string, ReadableStreamDefaultController<Uint8Array>>;
    private chunkBuffers: Map<string, Uint8Array[]>;
    private initSegments: Map<string, Uint8Array>; // Store init segments
    private pendingFragments: Map<string, MessageFragment[]>; // Buffer non-init fragments

    constructor() {
        this.segmentStreams = new Map();
        this.chunkBuffers = new Map();
        this.initSegments = new Map();
        this.pendingFragments = new Map();
    }

    async handleDatagram(datagram: Uint8Array, player: Player) {
        const isSegment = datagram.at(0)
        if (!isSegment) {
          const stream = new ReadableStream({
              start(controller) {
              controller.enqueue(datagram.slice(1));
              controller.close();
              }
          });
          player.handleStream(stream)
        }  
        const fragment = this.parseDatagram(datagram.slice(1));

        if (fragment.isInit) {
            this.initSegments.set(fragment.segmentID, fragment.data);
            this.initializeStream(fragment.segmentID, player);
            const controller = this.segmentStreams.get(fragment.segmentID);
            controller?.enqueue(fragment.data);
            this.processPendingFragments(fragment.segmentID); // Process any buffered fragments
        } else {
            if (this.segmentStreams.has(fragment.segmentID)) {
                this.storeFragment(fragment);
            } else {
                // Buffer the fragment if the init segment hasn't been received
                if (!this.pendingFragments.has(fragment.segmentID)) {
                    this.pendingFragments.set(fragment.segmentID, []);
                }
                this.pendingFragments.get(fragment.segmentID)?.push(fragment);
            }
        }
    }

    private initializeStream(segmentID: string, player: Player) {
        if (!this.segmentStreams.has(segmentID)) {
            const stream = new ReadableStream<Uint8Array>({
                start: (controller) => {
                    this.segmentStreams.set(segmentID, controller);
                },
                cancel: () => {
                  this.cleanup(segmentID);
                }
            });
            setTimeout(() => {
                this.segmentStreams.get(segmentID)?.close()
                this.cleanup(segmentID);
            }, 2000); 
            player.handleStream(stream);
        }
    }

    private processPendingFragments(segmentID: string) {
        const fragments = this.pendingFragments.get(segmentID) || [];
        fragments.forEach(fragment => this.storeFragment(fragment));
        this.pendingFragments.delete(segmentID);
    }

    private storeFragment(fragment: MessageFragment) {
      const chunkKey = `${fragment.segmentID}-${fragment.chunkID}`;
      if (!this.chunkBuffers.has(chunkKey)) {
          this.chunkBuffers.set(chunkKey, new Array(fragment.fragmentTotal).fill(null));
      }
  
      const buffer = this.chunkBuffers.get(chunkKey);
      if (buffer) {
          buffer[fragment.fragmentNumber] = fragment.data;
  
          // Check if all fragments in the buffer are filled
          if (buffer.every(element => element !== null)) {
              // Calculate the total length of the new Uint8Array
              const totalLength = buffer.reduce((acc, val) => acc + val.length, 0);
              const completeData = new Uint8Array(totalLength);
  
              // Copy each Uint8Array into completeData
              let offset = 0;
              buffer.forEach((chunk) => {
                  completeData.set(chunk, offset);
                  offset += chunk.length;
              });
  
              const controller = this.segmentStreams.get(fragment.segmentID);
              controller?.enqueue(completeData);
              this.chunkBuffers.delete(chunkKey);
          }
      }
  }
  

    private cleanup(segmentID: string) {
        this.segmentStreams.delete(segmentID);
        this.initSegments.delete(segmentID);
        this.pendingFragments.delete(segmentID);
    }

    private parseDatagram(datagram: Uint8Array): MessageFragment {
        const utf8Decoder = new TextDecoder("utf-8");
        const isInit = Boolean(datagram.at(0));
        const segmentID = utf8Decoder.decode(datagram.slice(1, 9));
        const chunkID = utf8Decoder.decode(datagram.slice(9, 17));
        const buf = datagram.slice(17, 21);
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const fragmentNumber = dv.getUint16(0);
        const fragmentTotal = dv.getUint16(2);
        const data = new Uint8Array(datagram.buffer.slice(21));

        return { isInit, segmentID, chunkID, fragmentNumber, fragmentTotal, data };
    }
}
