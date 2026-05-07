import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Clipboard, ExternalLink, RefreshCw } from "lucide-react";
import type { ARProject } from "../types/project";
import { buildInfo } from "../buildInfo";
import { hydrateRuntimeProject } from "../data/hydrateRuntimeProject";
import { projectRepository } from "../data/projectRepository";

export const TargetImagePage = ({ projectId }: { projectId: string }) => {
  const [project, setProject] = useState<ARProject | null>(null);
  const [status, setStatus] = useState("正在載入 Trigger Image");
  const [copied, setCopied] = useState(false);

  const loadProject = useCallback(async () => {
    try {
      setStatus("正在載入 Trigger Image");
      const stored = await projectRepository.getProject(projectId);
      const hydrated = await hydrateRuntimeProject(stored);
      setProject(hydrated);
      setStatus(hydrated.triggerImageUrl ? "請用手機掃描這張乾淨 Trigger 圖" : "這個專案尚未上傳 Trigger Image");
    } catch (error) {
      console.error(error);
      setStatus(error instanceof Error ? error.message : "Trigger Image 載入失敗");
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  const copyUrl = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <main className="target-page">
      <header className="target-header">
        <a href={`/viewer/${projectId}`} title="Back to viewer">
          <ArrowLeft size={18} />
        </a>
        <div>
          <span>{project?.name ?? "WebAR Project"}</span>
          <strong>{status}</strong>
        </div>
        <button onClick={copyUrl}>
          <Clipboard size={16} />
          {copied ? "Copied" : "Copy URL"}
        </button>
      </header>

      <section className="target-content">
        {project?.triggerImageUrl ? (
          <img className="target-image" src={project.triggerImageUrl} alt={`${project.name} trigger`} />
        ) : (
          <div className="target-empty">請先回 Editor 上傳 Trigger Image，並等到 .mind ready。</div>
        )}
      </section>

      <footer className="target-footer">
        <a href={`/editor/${projectId}`}>
          <ExternalLink size={16} />
          Editor
        </a>
        <a href={`/viewer/${projectId}`}>
          <ExternalLink size={16} />
          Viewer
        </a>
        <button onClick={loadProject}>
          <RefreshCw size={16} />
          Reload
        </button>
        <span>build {buildInfo.version}</span>
      </footer>
    </main>
  );
};
