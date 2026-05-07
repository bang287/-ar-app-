import { useEffect, type ReactNode } from "react";
import { Editor } from "./components/Editor";
import { Gallery } from "./components/Gallery";
import { Viewer } from "./components/Viewer";
import { ARTest } from "./components/ARTest";
import { MindARSmokeTest } from "./components/MindARSmokeTest";
import { TargetImagePage } from "./components/TargetImagePage";
import { Login } from "./components/Login";
import { useAuth } from "./auth/AuthContext";

const ProtectedBackstage = ({ children }: { children: ReactNode }) => {
  const { isAuthenticated, isLoading } = useAuth();
  useEffect(() => {
    if (isLoading || isAuthenticated) return;
    const redirect = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
    window.location.replace(`/login?redirect=${redirect}`);
  }, [isAuthenticated, isLoading]);

  if (isLoading) {
    return (
      <main className="auth-loading">
        <div>正在確認登入狀態...</div>
      </main>
    );
  }

  if (!isAuthenticated) {
    return (
      <main className="auth-loading">
        <div>正在前往登入頁...</div>
      </main>
    );
  }

  return <>{children}</>;
};

export const App = () => {
  const path = window.location.pathname;
  const arTestMatch = path.match(/^\/ar-test\/([^/]+)/);
  const targetMatch = path.match(/^\/target\/([^/]+)/);
  const viewerMatch = path.match(/^\/viewer\/([^/]+)/);
  const editorMatch = path.match(/^\/editor\/([^/]+)/);

  if (path === "/mindar-smoke-test") {
    return <MindARSmokeTest />;
  }

  if (path === "/login") {
    return <Login />;
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
    return (
      <ProtectedBackstage>
        <Editor projectId={editorMatch[1]} />
      </ProtectedBackstage>
    );
  }

  if (path === "/editor") {
    return (
      <ProtectedBackstage>
        <Gallery />
      </ProtectedBackstage>
    );
  }

  return (
    <ProtectedBackstage>
      <Gallery />
    </ProtectedBackstage>
  );
};
