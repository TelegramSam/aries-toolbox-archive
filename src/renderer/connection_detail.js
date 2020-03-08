const DIDComm = require('encryption-envelope-js');
const bs58 = require('bs58');
const rp = require('request-promise');
const uuidv4 = require('uuid/v4');
const WebSocketAsPromised = require('websocket-as-promised');


class ConnectionDetail {
    constructor(id, label, did_doc, my_key, inbound_processor = null) {
        this.id = id;
        this.label = label;
        this.did_doc = did_doc;
        this.my_key = my_key;

        this.inbound_processor = inbound_processor;

        this.didcomm = new DIDComm.DIDComm();

        // evaluate DID Document to pick transport
        // filter for IndyAgent / DIDComm
        let supported_types = ["IndyAgent", "did-communication"];
        this.service_list = this.did_doc.service.filter(s => supported_types.includes(s.type));
        function protocol(endpoint) {
            return endpoint.split(":")[0];
        }
        function servicePrioritySort(a, b){
            if(protocol(a.serviceEndpoint) === protocol(b.serviceEndpoint)){
                return 0; //same
            }
            if(protocol(a.serviceEndpoint) === "ws"){
                return -1; //higher priority
            } else { //b is ws
                return 1;
            }
        }
        this.service_list.sort(servicePrioritySort);

        this.service = this.service_list[0]; //use the first in the list
        this.service_transport_protocol = protocol(this.service.serviceEndpoint);

        if (this.service_transport_protocol === "ws" ||
            this.service_transport_protocol === "wss") {

            this.socket = new WebSocketAsPromised(this.service.serviceEndpoint, {
                // WebSocket specific pack steps
                packMessage: data => {
                    return new Buffer.from(data, 'ascii');
                },
                unpackMessage: async data => {
                    if (data instanceof Blob) {
                        data = await blobToStr(data);
                    }
                    return data;
                }
            });

            // Listen for messages
            this.socket.onUnpackedMessage.addListener(async event => {
                this.process_inbound(await this.unpackMessage(await event));
            });
        }
    }

    needs_return_route_poll() {
        return this.service_transport_protocol === "http" || this.service_transport_protocol === "https";
    }

    async send_message(msg, set_return_route = true) {
        console.log("Sending message:", msg);

        if (!('@id' in msg)) { // Ensure @id is populated
            msg['@id'] = uuidv4().toString();
        }

        if (set_return_route) {
            if (!("~transport" in msg)) {
                msg["~transport"] = {}
            }
            msg["~transport"]["return_route"] = "all"
        }

        const packedMsg = await this.packMessage(msg);

        // Send message
        if (this.service_transport_protocol === "http" ||
            this.service_transport_protocol === "https") {

            var options = {
                method: 'POST',
                uri: this.service.serviceEndpoint,
                body: packedMsg,
            };
            rp(options)
                .then(async parsedBody => { // POST succeeded...
                    if (!parsedBody) {
                        console.log("No response for post; continuing.");
                        return;
                    }
                    await this.process_inbound(await this.unpackMessage(parsedBody));
                })
                .catch(function (err) { // POST failed...
                    console.log("Error while sending message:", err);
                });
        } else if (this.service_transport_protocol === "ws" ||
            this.service_transport_protocol === "wss") {

            if (this.socket) {
                await this.socket.open();
            } else {
                throw 'No socket connection available';
            }

            this.socket.sendPacked(packedMsg);
        } else {
            throw "Unsupported transport protocol";
        }
    }

    async packMessage(msg) {
        await this.didcomm.Ready;
        return await this.didcomm.packMessage(
            JSON.stringify(msg),
            [bs58.decode(this.service.recipientKeys[0])],
            this.my_key
        );
    }

    async unpackMessage(packed_msg) {
        await this.didcomm.Ready;
        const unpackedResponse = await this.didcomm.unpackMessage(packed_msg, this.my_key);
        //console.log("unpacked", unpackedResponse);
        return JSON.parse(unpackedResponse.message);
    }

    process_inbound(msg) {
        console.log('Received Message:', msg);
        this.inbound_processor(msg);
    }

    to_store() {
        return {
            id: this.id,
            label: this.label,
            did_doc: this.did_doc,
            my_key_b58: {
                privateKey: this.my_key.privateKey_b58,
                publicKey: this.my_key.publicKey_b58
            }
        }
    }
}

async function blobToStr(blob) {
    return await new Promise((resolve, reject) => {
        let reader = new FileReader();
        reader.addEventListener("loadend", async function(){
            resolve(reader.result);
        });
        reader.readAsText(blob);
    });
}


function new_connection(label, did_doc, my_key, inbound_processor) {
    return new ConnectionDetail(
        (uuidv4().toString()),
        label,
        did_doc,
        my_key,
        inbound_processor
    );
}

function from_store(obj, inbound_processor) {
    let my_key = {
        privateKey: bs58.decode(obj.my_key_b58.privateKey),
        publicKey: bs58.decode(obj.my_key_b58.publicKey),
        publicKey_b58: obj.my_key_b58.publicKey_b58,
        privateKey_b58: obj.my_key_b58.privateKey_b58
    };
    return new ConnectionDetail(
        obj.id,
        obj.label,
        obj.did_doc,
        my_key,
        inbound_processor
    );
}

export { ConnectionDetail, new_connection, from_store };
