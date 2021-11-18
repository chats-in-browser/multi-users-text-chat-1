const appPrefix = "secure-p2p-multichat-"; // the prefix we will preprend to usernames

const oldChats = localStorage.getItem("chats");
const chats = oldChats ? JSON.parse(oldChats) : []; // oldChats may be undefined, which throws error if passed into JSON.parse

const app = new Vue({
    el: "#app",
    data: {
        screen: "login", // initialize at login screen
        usernameInput: localStorage.getItem("username"), // to load saved username
        peerError: "",
        loading: false,
        peer: {}, // initialize as empty object instead of undefined
        targetIdInput: "",
        peerIds: [], // connected to nobody at first
        connections: {}, // maps peerIds to their correspondig PeerJS's DataConnection objects
        chats,
        chatMessageInput: ""
    },
    // in case you want to enable automatic login
    /*mounted: function () {
        if (this.usernameInput && this.usernameInput.length > 0) {
            this.submitLogin();
        }
    },*/
    watch: {
        chats: function() {
            const chatbox = document.getElementById("chatbox");
            if (chatbox) chatbox.scrollTop = 99999999; // to automatically scroll the chatbox to the most recent chat message
        }
    },
    methods: {
        // util functions to convert username to peer ids and vice-versa
        getPeerId: username => appPrefix + username,
        getUsername: peerId => peerId ? peerId.slice(appPrefix.length) : "",

        // we keep track of connections ourselves as suggested in peerjs's documentation
        addConnection: function(conn) {
            this.connections[conn.peer] = conn;
            this.updatePeerIds();

            console.log(`Connected to ${conn.peer}!`);
        },
        removeConnection: function(conn) {
            delete this.connections[conn.peer];
            this.updatePeerIds();
        },
        updatePeerIds: function() {
            this.peerIds = Object.keys(this.connections);
        },
        disconnectPeer: function() {
            this.peer.disconnect();
        },

        // called to properly configure connection's client listeners
        configureConnection: function(conn) {
            conn.on("data", data => {
                // if data is about connections (the list of peers sent when connected)
                if (data.type === "connections") {
                    data.peerIds.forEach(peerId => {
                        if (!this.connections[peerId]) {
                            this.initiateConnection(peerId);
                        }
                    });
                } else if (data.type === "chat") {
                    this.receiveChat(data.chat);
                }
                // please note here that if data.type is undefined, this endpoint won't do anything!
            });
            conn.on("close", () => this.removeConnection(conn));
            conn.on("error", () => this.removeConnection(conn));

            // if the caller joins have a call, we merge calls
            conn.metadata.peerIds.forEach(peerId => {
                if (!this.connections[peerId]) {
                    this.initiateConnection(peerId);
                }
            });
        },
        // called to initiate a connection (by the caller)
        initiateConnection: function(peerId) {
            if (!this.peerIds.includes(peerId) && peerId !== this.peer.id) {
                this.loading = true;
                this.peerError = "";

                console.log(`Connecting to ${peerId}...`);

                const options = {
                    metadata: {
                        // if the caller has peers, we send them to merge calls
                        peerIds: this.peerIds
                    },
                    serialization: "json"
                };
                const conn = this.peer.connect(peerId, options);
                this.configureConnection(conn);

                conn.on("open", () => {
                    this.addConnection(conn);
                    if (this.getUsername(conn.peer) === this.targetIdInput) {
                        this.targetIdInput = "";
                        this.loading = false;
                    }
                });
            }
        },
        createPeer: function() {
            // options are useful in development to connect to local peerjs server
            this.peer = new Peer(this.getPeerId(this.usernameInput)
                /*, {
                                host: 'localhost',
                                port: 8080,
                                path: 'app'
                            }*/
            );

            // when peer is connected to signaling server
            this.peer.on("open", () => {
                this.screen = "chat"; // changing screen
                this.loading = false;
                this.peerError = "";
            });
            // error listener
            this.peer.on("error", error => {
                if (error.type === "peer-unavailable") { // if connection with new peer can't be established
                    this.loading = false;
                    this.peerError = `${this.targetIdInput} is unreachable!`; // custom error message
                    this.targetIdInput = "";
                } else if (error.type === "unavailable-id") { // if requested id (thus username) is already taken
                    this.loading = false;
                    this.peerError = `${this.usernameInput} is already taken!`; // custom error message
                } else this.peerError = error; // default error message
            });

            // when peer receives a connection
            this.peer.on('connection', conn => {
                if (!this.peerIds.includes(conn.peer)) {
                    this.configureConnection(conn);

                    conn.on("open", () => {
                        this.addConnection(conn);

                        // send every connection previously established to connect everyone (merge chat rooms)
                        conn.send({
                            type: "connections",
                            peerIds: this.peerIds
                        });
                    });
                }
            });
        },

        submitLogin: function(event) {
            if (event) event.preventDefault(); // to prevent default behavior which is to POST to the same page

            if (this.usernameInput.length > 0 && !this.loading) {
                this.loading = true; // update status
                this.peerError = ""; // reset error status

                localStorage.setItem("username", this.usernameInput); // set username cookie to instanciate it at the next session

                this.createPeer();
            }
        },
        submitConnection: function(event) {
            event.preventDefault(); // to prevent default behavior which is to POST to the same page

            const peerId = this.getPeerId(this.targetIdInput); // the peer's id we want to connect to
            this.initiateConnection(peerId);
        },
        receiveChat: function(chat) {
            this.chats.push(chat);
            localStorage.setItem("chats", JSON.stringify(this.chats));
        },
        submitChat: function(event) {
            event.preventDefault(); // to prevent default behavior which is to POST to the same page

            if (this.chatMessageInput.length > 0) {
                // the chat object's data
                const chat = {
                    sender: this.usernameInput,
                    message: this.chatMessageInput,
                    timestamp: new Date().getTime()
                };

                this.receiveChat(chat); // simulate receiving a chat
                // send chat object to connected users
                Object.values(this.connections).forEach(conn => {
                    conn.send({
                        type: "chat",
                        chat
                    });
                });

                this.chatMessageInput = ""; // reset chat message input
            }
        }
    }
});