"use client";
import React, { useEffect } from "react";
import { socket } from "@/socket";
import * as mediasoup from "mediasoup-client";
import Consumer from "./Consumer";

const Home = ({ params: { roomName } }) => {
  const localVideo = React.useRef(null);
  const remoteVideo = React.useRef(null);
  const rtpCapabilities = React.useRef(null);
  const params = React.useRef({
    // mediasoup params
    encodings: [
      {
        rid: "r0",
        maxBitrate: 100000,
        scalabilityMode: "S3T3",
      },
      {
        rid: "r1",
        maxBitrate: 300000,
        scalabilityMode: "S3T3",
      },
      {
        rid: "r2",
        maxBitrate: 900000,
        scalabilityMode: "S3T3",
      },
    ],
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#ProducerCodecOptions
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  });
  const device = React.useRef(null);
  const producerTransport = React.useRef(null);
  const producer = React.useRef(null);
  const [consumerTransports, setConsumerTransports] = React.useState([]);
  const consumer = React.useRef(null);
  const isProducer = React.useRef(false);
  const runOnce = React.useRef(false);
  useEffect(() => {
    if (runOnce.current) return;
    socket.on("connection-success", ({ socketId, existsProducer }) => {
      console.log(`Connected with socketId: ${socketId}, ${existsProducer}`);
    });
    socket.on("new-producer", ({ producerId }) =>
      signalNewConsumerTransport(producerId)
    );

    getLocalStream();
    runOnce.current = true;
  }, []);

  const getLocalStream = () => {
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then((stream) => {
        localVideo.current.srcObject = stream;
        const track = stream.getVideoTracks()[0];
        params.current.track = track;
        joinRoom();
      })
      .catch((err) => {
        console.error(err);
      });
  };

  const joinRoom = () => {
    socket.emit("joinRoom", { roomName }, (data) => {
      console.log(`Router RTP Capabilities... ${data.rtpCapabilities}`);
      // we assign to local variable and will be used when
      // loading the client Device (see createDevice above)
      rtpCapabilities.current = data.rtpCapabilities;

      // once we have rtpCapabilities from the Router, create Device
      createDevice();
    });
  };

  const goConsume = () => {
    goConnect(false);
  };

  const goConnect = (producerOrConsumer) => {
    isProducer.current = producerOrConsumer;
    !device.current ? getRtpCapabilities() : goCreateTransport();
  };

  const goCreateTransport = () => {
    isProducer.current ? createSendTransport() : createRecvTransport();
  };

  const getRtpCapabilities = async () => {
    socket.emit("createRoom", (data) => {
      console.log(data);
      rtpCapabilities.current = data.rtpCapabilities;
      createDevice();
    });
  };

  const createDevice = async () => {
    device.current = new mediasoup.Device();
    await device.current.load({
      routerRtpCapabilities: rtpCapabilities.current,
    });
    console.log(device.current.rtpCapabilities);
    createSendTransport();
  };

  const getProducers = () => {
    socket.emit("getProducers", (producerIds) => {
      console.log(producerIds);
      // for each of the producer create a consumer
      // producerIds.forEach(id => signalNewConsumerTransport(id))
      producerIds.forEach(signalNewConsumerTransport);
    });
  };

  const createSendTransport = () => {
    // see server's socket.on('createWebRtcTransport', sender?, ...)
    // this is a call from Producer, so sender = true
    socket.emit("createWebRtcTransport", { consumer: false }, ({ params }) => {
      // The server sends back params needed
      // to create Send Transport on the client side
      if (params.error) {
        console.log(params.error);
        return;
      }

      console.log(params);

      // creates a new WebRTC Transport to send media
      // based on the server's producer transport params
      // https://mediasoup.org/documentation/v3/mediasoup-client/api/#TransportOptions
      producerTransport.current = device.current.createSendTransport(params);

      // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
      // this event is raised when a first call to transport.produce() is made
      // see connectSendTransport() below
      producerTransport.current.on(
        "connect",
        async ({ dtlsParameters }, callback, errback) => {
          try {
            // Signal local DTLS parameters to the server side transport
            // see server's socket.on('transport-connect', ...)
            await socket.emit("transport-connect", {
              dtlsParameters,
            });

            // Tell the transport that parameters were transmitted.
            callback();
          } catch (error) {
            errback(error);
          }
        }
      );

      producerTransport.current.on(
        "produce",
        async (parameters, callback, errback) => {
          console.log(parameters);

          try {
            // tell the server to create a Producer
            // with the following parameters and produce
            // and expect back a server side producer id
            // see server's socket.on('transport-produce', ...)
            await socket.emit(
              "transport-produce",
              {
                kind: parameters.kind,
                rtpParameters: parameters.rtpParameters,
                appData: parameters.appData,
              },
              ({ id, producersExist }) => {
                // Tell the transport that parameters were transmitted and provide it with the
                // server side producer's id.
                callback({ id });
                if (producersExist) getProducers();
              }
            );
          } catch (error) {
            errback(error);
          }
        }
      );
      connectSendTransport();
    });
  };

  const connectSendTransport = async () => {
    // we now call produce() to instruct the producer transport
    // to send media to the Router
    // https://mediasoup.org/documentation/v3/mediasoup-client/api/#transport-produce
    // this action will trigger the 'connect' and 'produce' events above
    producer.current = await producerTransport.current.produce(params.current);

    producer.current.on("trackended", () => {
      console.log("track ended");

      // close video track
    });

    producer.current.on("transportclose", () => {
      console.log("transport ended");

      // close video track
    });
  };

  const signalNewConsumerTransport = async (remoteProducerId) => {
    // see server's socket.on('consume', sender?, ...)
    // this is a call from Consumer, so sender = false
    await socket.emit(
      "createWebRtcTransport",
      { consumer: true },
      ({ params }) => {
        // The server sends back params needed
        // to create Send Transport on the client side
        if (params.error) {
          console.log(params.error);
          return;
        }

        console.log(params);

        // creates a new WebRTC Transport to receive media
        // based on server's consumer transport params
        // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-createRecvTransport
        let consumerTransport = device.current.createRecvTransport(params);

        // https://mediasoup.org/documentation/v3/communication-between-client-and-server/#producing-media
        // this event is raised when a first call to transport.produce() is made
        // see connectRecvTransport() below
        consumerTransport.on(
          "connect",
          async ({ dtlsParameters }, callback, errback) => {
            try {
              // Signal local DTLS parameters to the server side transport
              // see server's socket.on('transport-recv-connect', ...)
              await socket.emit("transport-recv-connect", {
                dtlsParameters,
              });

              // Tell the transport that parameters were transmitted.
              callback();
            } catch (error) {
              // Tell the transport that something was wrong
              errback(error);
            }
          }
        );
        connectRecvTransport(consumerTransport, remoteProducerId, params.id);
      }
    );
  };

  const connectRecvTransport = async (
    consumerTransport,
    remoteProducerId,
    serverConsumerTransportId
  ) => {
    // for consumer, we need to tell the server first
    // to create a consumer based on the rtpCapabilities and consume
    // if the router can consume, it will send back a set of params as below
    await socket.emit(
      "consume",
      {
        rtpCapabilities: device.current.rtpCapabilities,
        remoteProducerId,
        serverConsumerTransportId,
      },
      async ({ params }) => {
        if (params.error) {
          console.log("Cannot Consume");
          return;
        }

        console.log(params);
        // then consume with the local consumer transport
        // which creates a consumer
        const consumer = await consumerTransport.consume({
          id: params.id,
          producerId: params.producerId,
          kind: params.kind,
          rtpParameters: params.rtpParameters,
        });

        setConsumerTransports((prev) => [
          ...prev,
          {
            consumerTransport,
            serverConsumerTransportId: params.id,
            producerId: remoteProducerId,
            consumer,
          },
        ]);
      }
    );
  };

  return (
    <div>
      <video ref={localVideo} autoPlay muted controls />
      {consumerTransports.map((consumerTransport) => (
        <Consumer
          key={consumerTransport.serverConsumerId}
          consumerTransport={consumerTransport}
          socket={socket}
        />
      ))}
    </div>
  );
};

export default Home;
