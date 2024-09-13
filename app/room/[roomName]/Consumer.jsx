import React, { useEffect, useRef } from "react";

const Consumer = ({ consumerTransport, socket }) => {
  const videoRef = useRef();
  useEffect(() => {
    const { track } = consumerTransport.consumer;

    videoRef.current.srcObject = new MediaStream([track]);

    socket.emit("consumer-resume", {
      serverConsumerId: consumerTransport.serverConsumerTransportId,
    });
    console.log(`consumer transport:`, consumerTransport);
  }, []);
  return <video ref={videoRef} autoPlay controls playsInline />;
};

export default Consumer;
