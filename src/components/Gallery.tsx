import { useEffect, useMemo, useState } from "react";
import { Box, Download, Edit3, FolderPlus, LogOut, Menu, MoreVertical, Play, Plus, Search, Sparkles, Trash2, Type } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import type { ARFolder, ARProject } from "../types/project";
import { projectRepository } from "../data/projectRepository";

const seasonTags = ["立春", "春分", "芒種", "白露", "霜降", "冬至"];

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("zh-Hant", {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

const stars = (score: number) => "★★★★★".slice(0, Math.max(1, Math.min(5, Math.round(score || 4))));

const downloadArtworkJson = (project: ARProject) => {
  const payload = { ...project, downloadedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${project.name.replace(/[^\w.-]+/g, "-") || "chengqi-project"}-${project.id}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const Gallery = () => {
  const { user, signOut } = useAuth();
  const [folders, setFolders] = useState<ARFolder[]>([]);
  const [projects, setProjects] = useState<ARProject[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null);
  const [openMenuFolderId, setOpenMenuFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("正在載入作品");

  const load = async () => {
    const [nextFolders, nextProjects] = await Promise.all([projectRepository.listFolders(), projectRepository.listProjects()]);
    setFolders(nextFolders);
    setProjects(nextProjects);
    setStatus(`已載入 ${nextProjects.length} 個作品`);
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    const close = () => {
      setOpenMenuProjectId(null);
      setOpenMenuFolderId(null);
    };
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  const filteredProjects = useMemo(
    () =>
      projects.filter((project) => {
        const folderMatch = selectedFolder ? project.folderId === selectedFolder : true;
        const queryMatch = project.name.toLowerCase().includes(query.toLowerCase());
        return folderMatch && queryMatch;
      }),
    [projects, query, selectedFolder],
  );

  const createFolder = async () => {
    const name = window.prompt("請輸入資料夾名稱", "New Folder");
    if (!name) return;
    await projectRepository.createFolder(name);
    await load();
  };

  const createArtwork = async () => {
    const name = window.prompt("請輸入 AR 作品名稱", "New AR Artwork");
    if (!name) return;
    const project = await projectRepository.createProject(name, selectedFolder ?? undefined);
    window.location.href = `/editor/${project.id}`;
  };

  const deleteArtwork = async (project: ARProject) => {
    const confirmed = window.confirm(`確定要刪除「${project.name}」嗎？這只會刪除單一作品資料，不會批量刪除其他作品。`);
    if (!confirmed) return;
    await projectRepository.deleteProject(project.id);
    setOpenMenuProjectId(null);
    await load();
  };

  const renameFolder = async (folder: ARFolder) => {
    const name = window.prompt("請輸入新的資料夾名稱", folder.name);
    if (!name || name === folder.name) return;
    await projectRepository.updateFolder(folder.id, name);
    setOpenMenuFolderId(null);
    await load();
  };

  const publishFolder = async (folder: ARFolder) => {
    const folderProjects = projects.filter((project) => project.folderId === folder.id);
    if (folderProjects.length === 0) {
      setStatus("這個資料夾目前沒有作品可以發布");
      setOpenMenuFolderId(null);
      return;
    }
    await Promise.all(folderProjects.map((project) => projectRepository.saveProject({ ...project, status: "published" })));
    setStatus(`已發布 ${folderProjects.length} 個 WebAR 作品`);
    setOpenMenuFolderId(null);
    await load();
  };

  const deleteFolder = async (folder: ARFolder) => {
    const confirmed = window.confirm(`確定要刪除資料夾「${folder.name}」嗎？作品不會被刪除，只會移除分類。`);
    if (!confirmed) return;
    await projectRepository.deleteFolder(folder.id);
    if (selectedFolder === folder.id) setSelectedFolder(null);
    setOpenMenuFolderId(null);
    await load();
  };

  const logout = async () => {
    await signOut();
    window.location.href = "/login";
  };

  return (
    <main className="gallery-shell">
      <header className="gallery-topbar">
        <div className="brand-block">
          <button className="icon-button" title="Menu">
            <Menu size={21} />
          </button>
          <a className="wordmark" href="/">
            承氣
          </a>
        </div>
        <label className="search-box">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋作品、節氣或資料夾" />
        </label>
        <div className="gallery-actions">
          <span>{status}</span>
          <button onClick={createArtwork}>
            <Plus size={17} />
            建立作品
          </button>
          <a className="discover-button" href={projects[0] ? `/viewer/${projects[0].id}` : "/"}>
            掃描展示
          </a>
          <div className="account-pill">
            <span>{user?.email ?? "本機模式"}</span>
            <button onClick={logout} title="登出">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <section className="season-banner">
        <div>
          <span>二十四節氣工作台</span>
          <h1>用花、影像與時間設計自己的 AR 作品</h1>
        </div>
        <div className="season-tags" aria-label="節氣標籤">
          {seasonTags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
      </section>

      <section className="gallery-content">
        <div className="gallery-section-heading">
          <h1>資料夾</h1>
          <button onClick={createFolder}>
            <FolderPlus size={18} />
            新增資料夾
          </button>
        </div>
        <div className="folder-row">
          <button className={`folder-card ${selectedFolder === null ? "selected" : ""}`} onClick={() => setSelectedFolder(null)}>
            <FolderPlus size={36} />
            <span>全部作品</span>
          </button>
          {folders.map((folder) => (
            <div className={`folder-card folder-card-menu ${selectedFolder === folder.id ? "selected" : ""} ${openMenuFolderId === folder.id ? "menu-open" : ""}`} key={folder.id} onClick={() => setSelectedFolder(folder.id)}>
              <FolderPlus size={36} />
              <span>{folder.name}</span>
              <div className="folder-menu-wrap" onClick={(event) => event.stopPropagation()}>
                <button className="card-icon" title="Folder actions" onClick={() => setOpenMenuFolderId((current) => (current === folder.id ? null : folder.id))}>
                  <MoreVertical size={22} />
                </button>
                {openMenuFolderId === folder.id && (
                  <div className="folder-action-menu">
                    <button onClick={() => renameFolder(folder)}>
                      <Type size={18} />
                      重新命名
                    </button>
                    <button onClick={() => publishFolder(folder)}>
                      <Box size={18} />
                      發布為 WebAR
                    </button>
                    <button className="danger" onClick={() => deleteFolder(folder)}>
                      <Trash2 size={18} />
                      刪除資料夾
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="gallery-section-heading art-heading">
          <h1>作品</h1>
          <button onClick={createArtwork}>
            <Sparkles size={18} />
            新作品
          </button>
        </div>
        <div className="artwork-grid">
          {filteredProjects.length === 0 && (
            <div className="empty-gallery">
              <p>目前沒有符合條件的作品。建立一個 AR project，先上傳 Trigger Image，再加入圖片或影片圖層。</p>
              <button onClick={createArtwork}>建立作品</button>
            </div>
          )}
          {filteredProjects.map((project) => (
            <article className="artwork-card" key={project.id}>
              <a className="artwork-cover" href={`/editor/${project.id}`}>
                {project.thumbnailUrl ? <img src={project.thumbnailUrl} alt={project.name} /> : <div className="placeholder-cover">承氣 AR</div>}
                <span className="webar-tag">WebAR</span>
              </a>
              <div className="artwork-stats">
                <div>
                  <span>辨識品質</span>
                  <strong>{stars(project.recognitionScore)}</strong>
                </div>
                <div>
                  <span>本月觀看</span>
                  <strong>{project.viewsMonth}</strong>
                </div>
              </div>
              <div className="artwork-meta">
                <a href={`/editor/${project.id}`}>
                  <strong>{project.name}</strong>
                  <span>{formatDate(project.updatedAt)}</span>
                </a>
                <a className="card-icon" href={`/viewer/${project.id}`} title="Viewer">
                  <Play size={22} fill="currentColor" />
                </a>
                <div className="artwork-menu-wrap" onClick={(event) => event.stopPropagation()}>
                  <button className="card-icon" title="More" onClick={() => setOpenMenuProjectId((current) => (current === project.id ? null : project.id))}>
                    <MoreVertical size={22} />
                  </button>
                  {openMenuProjectId === project.id && (
                    <div className="artwork-menu">
                      <a href={`/editor/${project.id}`}>
                        <Edit3 size={18} />
                        編輯作品
                      </a>
                      <a href={`/viewer/${project.id}`}>
                        <Box size={18} />
                        檢視 WebAR
                      </a>
                      <button onClick={() => downloadArtworkJson(project)}>
                        <Download size={18} />
                        下載 project JSON
                      </button>
                      <button className="danger" onClick={() => deleteArtwork(project)}>
                        <Trash2 size={18} />
                        刪除作品
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
};
