import { Player } from "./player";

type MessageFragment = {
    fragmentedFlag: number;
    fragmentId: string;
    fragmentNumber: number;
    fragmentTotal: number;
    data: Uint8Array;
};

export class FragmentedMessageHandler {
    private fragmentBuffers: Map<string, Map<number, Uint8Array>>;
    private nextFragmentNumbers: Map<string, number>;
    private streamControllers: Map<string, ReadableStreamDefaultController<Uint8Array>>;
  
    constructor() {
      this.fragmentBuffers = new Map();
      this.nextFragmentNumbers = new Map();
      this.streamControllers = new Map();
    }
  
    handleDatagram(datagram: Uint8Array, player: Player) {
        if (!datagram.at(0)) {
            console.log("not fragmented");
            const stream = new ReadableStream({
                start(controller) {
                controller.enqueue(datagram.slice(1)); // Enqueue the sliced data
                controller.close(); // Close the stream
                }
            });
            player.handleStream(stream)
        }
        console.log("fragmented")
        const fragment = this.parseDatagram(datagram);
  
        if (!this.streamControllers.has(fragment.fragmentId)) {
            const stream = new ReadableStream<Uint8Array>({
                start: (controller) => {
                this.streamControllers.set(fragment.fragmentId, controller);
                this.fragmentBuffers.set(fragment.fragmentId, new Map());
                this.nextFragmentNumbers.set(fragment.fragmentId, 0);
                },
                cancel: () => {
                this.cleanup(fragment.fragmentId);
                }
            });
            setTimeout(() => {
                this.streamControllers.get(fragment.fragmentId)?.close()
                this.cleanup(fragment.fragmentId);
            }, 2000); 
            this.storeFragment(fragment);
            player.handleStream(stream)
        } else {
            this.storeFragment(fragment);
        }
    }
  
    private storeFragment(fragment: MessageFragment) {
        const buffers = this.fragmentBuffers.get(fragment.fragmentId);
        if (buffers) {
            buffers.set(fragment.fragmentNumber, fragment.data);
            this.processFragments(fragment.fragmentId, fragment.fragmentTotal);
        }   
    }
  
    private processFragments(fragmentId: string, fragmentTotal: number) {
      const buffers = this.fragmentBuffers.get(fragmentId);
      const controller = this.streamControllers.get(fragmentId);
      let nextFragmentNumber = this.nextFragmentNumbers.get(fragmentId);
  
      if (buffers && controller && nextFragmentNumber !== undefined) {
        while (buffers.has(nextFragmentNumber)) {
          const data = buffers.get(nextFragmentNumber);
          if (data) {
            controller.enqueue(data);
            buffers.delete(nextFragmentNumber);
            nextFragmentNumber++;
          }
        }
        this.nextFragmentNumbers.set(fragmentId, nextFragmentNumber);
  
        // If there are no more fragments expected and all have been processed
        
        if (nextFragmentNumber === fragmentTotal) {
          controller.close(); // TODO: mighnt need to change this
          this.cleanup(fragmentId);
        }
      }
    }
  
    private cleanup(fragmentId: string) {
      this.fragmentBuffers.delete(fragmentId);
      this.streamControllers.delete(fragmentId);
      this.nextFragmentNumbers.delete(fragmentId);
    }
  
    private parseDatagram(datagram: Uint8Array): MessageFragment {
      const utf8Decoder = new TextDecoder("utf-8");
      const fragmentedFlag = Number(datagram.at(0));
      const fragmentId = utf8Decoder.decode(datagram.slice(1, 9));
      const buf = datagram.slice(9, 13);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const fragmentNumber = dv.getUint16(0);
      const fragmentTotal = dv.getUint16(2);
      const data = new Uint8Array(datagram.buffer.slice(13)); // Data starts at byte 13
  
      return { fragmentedFlag, fragmentId, fragmentNumber, fragmentTotal, data };
    }
  }