export const cameraConstraints: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: "environment" },
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

export const requestCameraStream = async () => {
  if (!window.isSecureContext) {
    throw new Error("Camera requires HTTPS. Please open the Netlify HTTPS URL in Chrome or Safari.");
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support getUserMedia. Please use Chrome on Android or Safari on iOS.");
  }
  return navigator.mediaDevices.getUserMedia(cameraConstraints);
};

export const stopMediaStream = (stream?: MediaStream | null) => {
  stream?.getTracks().forEach((track) => track.stop());
};

export const cameraErrorMessage = (error: unknown) => {
  if (!(error instanceof Error)) return "Camera failed with an unknown error.";
  if (error.name === "NotAllowedError") return "Camera permission was denied. Allow camera access and try again.";
  if (error.name === "NotFoundError") return "No camera was found on this device.";
  if (error.name === "NotReadableError") return "Camera is busy or blocked by another app.";
  if (error.name === "OverconstrainedError") return "Camera constraints failed. Try another browser or camera.";
  return error.message;
};
