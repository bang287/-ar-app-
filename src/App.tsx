import { Editor } from "./components/Editor";
import { Gallery } from "./components/Gallery";
import { Viewer } from "./components/Viewer";

export const App = () => {
  const path = window.location.pathname;
  const viewerMatch = path.match(/^\/viewer\/([^/]+)/);
  const editorMatch = path.match(/^\/editor\/([^/]+)/);

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
