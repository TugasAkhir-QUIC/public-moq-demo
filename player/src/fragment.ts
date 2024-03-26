import { Player } from "./player";

type MessageFragment = {
    fragmentedFlag: number;
    fragmentId: string;
    fragmentNumber: number;
    fragmentTotal: number;
    data: Uint8Array;
};

export class FragmentedMessageHandler {
    private fragmentBuffers: Map<string, Uint8Array[]> = new Map();
    // private fragmentCounts: Map<string, number> = new Map();

    constructor() {}

    async handleDatagram(datagram: Uint8Array, start: number, player: Player) {
        const fragment = this.parseDatagram(datagram);
        // if (fragment.fragmentNumber == 0)
        //     console.log("first fragment:",datagram)
        console.log(fragment)

        // Handle fragmented message
        if (!this.fragmentBuffers.has(fragment.fragmentId)) {
            this.fragmentBuffers.set(fragment.fragmentId, new Array(fragment.fragmentTotal).fill(new Uint8Array()));
            // this.fragmentCounts.set(fragment.fragmentId, fragment.fragmentTotal);
        }

        const buffers = this.fragmentBuffers.get(fragment.fragmentId);
        if (buffers) {
            buffers[fragment.fragmentNumber] = fragment.data;
            this.fragmentBuffers.set(fragment.fragmentId, buffers);

            // Check if all fragments are received
            const isComplete = buffers.every((buf) => buf.length > 0);
            if (isComplete) {
                // Reassemble and handle complete message
                let completeData = buffers.reduce((acc, val) => new Uint8Array([...acc, ...val]), new Uint8Array());
                completeData = completeData.slice(1) // remove segmentFlag
                const isLastSegment = completeData.at(0)
                completeData = completeData.slice(1)
                
                player.handleSegmentDataDatagram(completeData, Boolean(isLastSegment), start);
                // console.log(`Datagram processed:`, { datagram, isLastSegment, start });

                // Clean up
                this.fragmentBuffers.delete(fragment.fragmentId);
                // this.fragmentCounts.delete(fragment.fragmentId);
            }
        }
    }

    private parseDatagram(datagram: Uint8Array): MessageFragment {
        const utf8Decoder = new TextDecoder("utf-8");
        // const view = new DataView(datagram.buffer, datagram.byteOffset, datagram.byteLength);
        const fragmentedFlag = Number(datagram.at(0));
        const fragmentId = utf8Decoder.decode(datagram.slice(1,9));
        
        const buf = datagram.slice(9, 13)
		const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
        const fragmentNumber = dv.getUint16(0);
        const fragmentTotal = dv.getUint16(2);

        // const bufNumber = datagram.slice(9, 11)
		// const dvNumber = new DataView(bufNumber.buffer, bufNumber.byteOffset, bufNumber.byteLength)
        // const fragmentNumber = dvNumber.getUint16(0);
        
        // const bufTotal = datagram.slice(11, 13)
		// const dvTotal = new DataView(bufTotal.buffer, bufTotal.byteOffset, bufTotal.byteLength)
        // const fragmentTotal = dvTotal.getUint16(0);

        const data = new Uint8Array(datagram.buffer.slice(13)); // Data starts at byte 12

        return { fragmentedFlag, fragmentId, fragmentNumber, fragmentTotal, data };
    }

    private handleSegmentDataDatagram(datagram: Uint8Array, isLastSegment: boolean, start: number) {
        // Process the reassembled datagram or non-fragmented message
        console.log(`Datagram processed:`, { datagram, isLastSegment, start });
        // Here you would call this.handleSegmentDataDatagram(datagram, isLastSegment, start) with your actual logic
    }
}