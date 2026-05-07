import { Editor } from "./components/Editor";
import { Gallery } from "./components/Gallery";
import { Viewer } from "./components/Viewer";
import { ARTest } from "./components/ARTest";
import { MindARSmokeTest } from "./components/MindARSmokeTest";
import { TargetImagePage } from "./components/TargetImagePage";

export const App = () => {
  const path = window.location.pathname;
  const arTestMatch = path.match(/^\/ar-test\/([^/]+)/);
  const targetMatch = path.match(/^\/target\/([^/]+)/);
  const viewerMatch = path.match(/^\/viewer\/([^/]+)/);
  const editorMatch = path.match(/^\/editor\/([^/]+)/);

  if (path === "/mindar-smoke-test") {
    return <MindARSmokeTest />;
  }

  if (arTestMatch) {
    return <ARTest projectId={arTestMatch[1]} />;
  }

  if (targetMatch) {
    return <TargetImagePage projectId={targetMatch[1]} />;
  }

  if (viewerMatch) {
    return <Viewer projectId={viewerMatch[1]} />;
  }

  if (editorMatch) {
    return <Editor projectId={editorMatch[1]} />;
  }

  if (path === "/editor") {
    return <Gallery />;
  }

  return <Gallery />;
};
