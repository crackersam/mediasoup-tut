import React, { useEffect, useRef } from "react";

const Consumer = ({ consumerTransport, socket }) => {
  const videoRef = useRef();
  const runOnce = useRef(false);
  useEffect(() => {
    if (runOnce.current) return;
    const { track } = consumerTransport.consumer;

    videoRef.current.srcObject = new MediaStream([track]);

    socket.emit("consumer-resume");
    runOnce.current = true;
  }, []);
  return <video ref={videoRef} autoPlay controls playsInline />;
};

export default Consumer;
