import { Player } from "./player";

type MessageFragment = {
    fragmentedFlag: number;
    fragmentId: string;
    fragmentNumber: number;
    isLastFragment: boolean
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
  
    async handleDatagram(datagram: Uint8Array, player: Player) {
        if (!datagram.at(0)) {
            const stream = new ReadableStream({
                start(controller) {
                controller.enqueue(datagram.slice(1));
                controller.close();
                }
            });
            player.handleStream(stream)
        }
        const fragment = this.parseDatagram(datagram);
        // console.log(fragment)

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
            this.processFragments(fragment.fragmentId, fragment.isLastFragment);
        }   
    }
  
    private processFragments(fragmentId: string, isLastFragment: boolean) {
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
        if (isLastFragment) {
          controller.close();
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
      const utf8Decoder = new TextDecoder;
      const buf = datagram.slice(0, 13);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const fragmentedFlag = dv.getUint8(0); // uint8 -> 1 byte
      const fragmentId = utf8Decoder.decode(datagram.slice(1,9));
      const fragmentNumber = dv.getUint16(9);
      const isLastFragment = Boolean(dv.getUint8(11));
      const data = new Uint8Array(datagram.buffer.slice(12));
      
      return { fragmentedFlag, fragmentId, fragmentNumber, isLastFragment, data };
    }
  }