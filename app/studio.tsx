"use client";
import { SettingMenu } from "./setting-menu";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  ImagePlus,
  Layers3,
  LayoutGrid,
  MessageSquare,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RotateCcw,
  Settings2,
  Sparkles,
  Trash2,
  X,
  LoaderCircle,
  Image as ImageIcon,
} from "lucide-react";
type Model = {
  id: string;
  label: string;
  sizes: { value: string; label: string; ratio: string }[];
  qualities: string[];
  maxReferences: number;
};
type Canvas = {
  id: string;
  title: string;
  updated: number;
  cover_id?: string | null;
};
type Output = { id: string; width: number; height: number };
type Job = {
  id: string;
  prompt: string;
  model: string;
  size: string;
  quality: string;
  count: number;
  refs: string[];
  parent_id: string | null;
  status: string;
  result_id: string | null;
  error: string | null;
  uncertain: number;
  created: number;
  outputs?: Output[];
  width?: number;
  height?: number;
};
type Me = {
  user: { id: string } | null;
  models: Model[];
  setupMessage: string | null;
  maxUpload: number;
};
type Draft = {
  prompt: string;
  model: string;
  size: string;
  quality: string;
  count: number;
  refs: string[];
  parentId: string | null;
  key: string;
};
const emptyDraft = (): Draft => ({
  prompt: "",
  model: "gpt-image-2",
  size: "1024x1024",
  quality: "medium",
  count: 1,
  refs: [],
  parentId: null,
  key: crypto.randomUUID(),
});
const imageUrl = (id: string) => `/api/assets/${id}`;
async function api<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method,
    headers: data ? { "Content-Type": "application/json" } : undefined,
    body: data ? JSON.stringify(data) : undefined,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}
function savedDraft(owner: string, id: string | null) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(`studio:${owner}:${id || "new"}`) || "null",
    );
    if (saved && typeof saved.prompt === "string" && Array.isArray(saved.refs))
      return {
        ...emptyDraft(),
        ...saved,
        model: "gpt-image-2",
        count: saved.count || 1,
      } as Draft;
  } catch {}
  return emptyDraft();
}
export default function Studio() {
  const [me, setMe] = useState<Me | null>(null),
    [loaded, setLoaded] = useState(false),
    [canvases, setCanvases] = useState<Canvas[]>([]),
    [canvasId, setCanvasId] = useState<string | null>(null),
    [jobs, setJobs] = useState<Job[]>([]),
    [draft, setDraft] = useState<Draft | null>(null);
  const [sidebar, setSidebar] = useState(true),
    [view, setView] = useState<"images" | "chat">("images"),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [drag, setDrag] = useState(false),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [preview, setPreview] = useState<Job | null>(null),
    [rename, setRename] = useState<Canvas | null>(null),
    [remove, setRemove] = useState<Canvas | null>(null),
    [regenerate, setRegenerate] = useState<Job | null>(null);
  const fileInput = useRef<HTMLInputElement>(null),
    promptInput = useRef<HTMLTextAreaElement>(null),
    submitLock = useRef(false),
    uploadLock = useRef(false),
    draftRef = useRef<Draft | null>(null),
    boot = useRef<Promise<Me> | null>(null);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  const refreshCanvases = useCallback(async () => {
    const rows = await api<Canvas[]>("sessions");
    setCanvases(rows);
    return rows;
  }, []);
  useEffect(() => {
    let live = true;
    boot.current ??= api<Me>("bootstrap", "POST");
    void (async () => {
      try {
        const value = await boot.current!;
        if (!live) return;
        setMe(value);
        setSidebar(window.innerWidth >= 760);
        const rows = value.user ? await api<Canvas[]>("sessions") : [];
        if (!live) return;
        setCanvases(rows);
        let id: string | null = null;
        try {
          id = value.user
            ? localStorage.getItem(`studio:last:${value.user.id}`)
            : null;
        } catch {}
        if (!rows.some((c) => c.id === id)) id = null;
        setCanvasId(id);
        setDraft(value.user ? savedDraft(value.user.id, id) : emptyDraft());
      } catch (e) {
        if (live) {
          setError((e as Error).message);
          setDraft(emptyDraft());
        }
      } finally {
        if (live) setLoaded(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!canvasId || !me?.user) return;
    let live = true;
    const poll = async () => {
      try {
        const result = await api<{ jobs: Job[] }>(`sessions/${canvasId}`);
        if (live) setJobs(result.jobs);
      } catch (e) {
        if (live) setError((e as Error).message);
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [canvasId, me?.user]);
  useEffect(() => {
    if (!me?.user || !draft) return;
    try {
      localStorage.setItem(
        `studio:${me.user.id}:${canvasId || "new"}`,
        JSON.stringify(draft),
      );
      if (canvasId) localStorage.setItem(`studio:last:${me.user.id}`, canvasId);
      else localStorage.removeItem(`studio:last:${me.user.id}`);
    } catch {}
  }, [draft, me?.user, canvasId]);
  const modal = !!(preview || rename || remove || regenerate);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const elements = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not([disabled]),a[href],input,textarea,select",
        ) || [],
      );
    elements()[0]?.focus();
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreview(null);
        setRename(null);
        setRemove(null);
        setRegenerate(null);
      }
      if (event.key === "Tab") {
        const nodes = elements(),
          first = nodes[0],
          last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      previous?.focus();
    };
  }, [modal]);
  function update(patch: Partial<Draft>) {
    setDraft((old) => ({
      ...(old || emptyDraft()),
      ...patch,
      key: crypto.randomUUID(),
    }));
    setError("");
  }
  function openCanvas(id: string | null) {
    setCanvasId(id);
    setJobs([]);
    setError("");
    setDraft(id && me?.user ? savedDraft(me.user.id, id) : emptyDraft());
    setView("images");
    if (window.innerWidth < 760) setSidebar(false);
  }
  async function ensureCanvas() {
    if (canvasId) return canvasId;
    const canvas = await api<Canvas>("sessions", "POST");
    setCanvases((old) => [canvas, ...old]);
    setCanvasId(canvas.id);
    return canvas.id;
  }
  async function attach(files: File[]) {
    if (!me?.user) {
      setError("Connect the studio database before adding references.");
      return;
    }
    if (!files.length || uploadLock.current || !draftRef.current) return;
    uploadLock.current = true;
    setUploading(true);
    setError("");
    try {
      const current = draftRef.current;
      if (files.length + current.refs.length > 4)
        throw new Error(
          "Bring up to 4 references, including the image you are editing.",
        );
      const sid = await ensureCanvas();
      let refs = [...current.refs];
      for (const file of files) {
        if (file.size > me.maxUpload)
          throw new Error("Each reference must be 4 MB or smaller.");
        const response = await fetch("/api/assets", {
          method: "POST",
          headers: {
            "x-session-id": sid,
            "Content-Type": file.type || "application/octet-stream",
          },
          body: file,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        refs = [...refs, result.id];
        update({ refs });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      uploadLock.current = false;
      setUploading(false);
    }
  }
  async function submit(override?: Draft) {
    const current = override || draftRef.current;
    if (
      !me?.user ||
      !current?.prompt.trim() ||
      submitLock.current ||
      uploadLock.current
    )
      return;
    submitLock.current = true;
    setBusy(true);
    setError("");
    try {
      const sid = await ensureCanvas();
      setDraft(current);
      try {
        localStorage.setItem(
          `studio:${me.user.id}:${sid}`,
          JSON.stringify(current),
        );
      } catch {}
      const job = await api<Job>("jobs", "POST", {
        ...current,
        sessionId: sid,
      });
      setJobs((old) =>
        old.some((j) => j.id === job.id) ? old : [...old, job],
      );
      setView("chat");
      await refreshCanvases();
      setToast("A little magic is on its way.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitLock.current = false;
      setBusy(false);
    }
  }
  function reuse(job: Job) {
    update({
      size: job.size,
      quality: ["medium", "high"].includes(job.quality)
        ? job.quality
        : "medium",
      count: job.count || 1,
    });
    setToast("Settings ready to go.");
  }
  function edit(job: Job) {
    update({
      prompt: "",
      size: job.size,
      quality: ["medium", "high"].includes(job.quality)
        ? job.quality
        : "medium",
      count: 1,
      refs: [job.result_id!],
      parentId: job.id,
    });
    setPreview(null);
    promptInput.current?.focus();
  }
  function restore(job: Job) {
    update({
      prompt: job.prompt,
      size: job.size,
      quality: job.quality,
      count: job.count || 1,
      refs: job.refs,
      parentId: job.parent_id,
    });
    promptInput.current?.focus();
  }
  async function copy(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setToast("Prompt copied.");
    } catch {
      setError(
        "Clipboard access was denied. You can copy the prompt from Conversation.",
      );
    }
  }
  const model = me?.models[0],
    canvas = canvases.find((c) => c.id === canvasId),
    pending = jobs.some(
      (j) => j.status === "queued" || j.status === "generating",
    );
  const outputs = jobs.flatMap((job) =>
    (job.outputs?.length
      ? job.outputs
      : job.result_id
        ? [
            {
              id: job.result_id,
              width: job.width || 0,
              height: job.height || 0,
            },
          ]
        : []
    ).map((output) => ({
      ...job,
      result_id: output.id,
      width: output.width,
      height: output.height,
    })),
  );
  const actions = (job: Job) => (
    <div className="result-actions">
      <a
        href={`${imageUrl(job.result_id!)}?download=1`}
        title="Download Original"
      >
        <Download size={15} />
        <span>Download</span>
      </a>
      <button onClick={() => edit(job)}>
        <Pencil size={14} />
        Edit image
      </button>
      <button
        onClick={() => copy(job.prompt)}
        title="Copy Prompt"
        aria-label="Copy Prompt"
      >
        <Copy size={15} />
      </button>
      <button
        onClick={() => reuse(job)}
        title="Reuse Settings"
        aria-label="Reuse Settings"
      >
        <Settings2 size={15} />
      </button>
      <button
        onClick={() => setRegenerate(job)}
        title="Regenerate — new paid request"
        aria-label="Regenerate — new paid request"
      >
        <RotateCcw size={15} />
      </button>
    </div>
  );
  const resultCard = (job: Job) => (
    <div className="image-card" key={job.result_id}>
      <button
        className="result-image"
        onClick={() => setPreview(job)}
        aria-label="Open large image preview"
      >
        <img src={imageUrl(job.result_id!)} alt={job.prompt} />
        <span>
          <Maximize2 size={17} />
        </span>
      </button>
      <div className="image-card-caption">
        <p>{job.prompt}</p>
        <small>
          {job.width} × {job.height} · {job.quality}
        </small>
      </div>
      {actions(job)}
    </div>
  );
  return (
    <div
      className={`studio ${sidebar ? "" : "sidebar-hidden"}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) setDrag(true);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void attach(Array.from(e.dataTransfer.files));
      }}
    >
      <header className="header">
        <div className="brand">
          <span className="brand-mark">
            <Layers3 size={20} />
          </span>
          Image Studio<span className="internal-tag">A PLACE TO PLAY</span>
        </div>
        <div className="header-right">
          <span className="header-note">Make something only you would.</span>
          <button
            className="new-session"
            disabled={busy || uploading}
            onClick={() => openCanvas(null)}
          >
            <Plus size={16} />
            <span>New canvas</span>
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <div className="sidebar-heading">
          <span>YOUR CANVASES</span>
          <button
            onClick={() => setSidebar(false)}
            aria-label="Collapse sidebar"
          >
            <PanelLeftClose size={17} />
          </button>
        </div>
        <button
          className={`session-row ${!canvasId ? "selected" : ""}`}
          disabled={busy || uploading}
          onClick={() => openCanvas(null)}
        >
          <Plus size={16} />
          <span>A fresh start</span>
        </button>
        <div className="session-list">
          {canvases.length === 0 ? (
            <div className="session-empty">
              <span className="small-line" />
              <p>
                Big ideas.
                <br />
                Happy accidents.
                <br />
                All welcome here.
              </p>
              <small>Your canvases will live here.</small>
            </div>
          ) : (
            canvases.map((item) => (
              <div
                className={`session-item ${canvasId === item.id ? "selected" : ""}`}
                key={item.id}
              >
                <button
                  disabled={busy || uploading}
                  className="session-row"
                  onClick={() => openCanvas(item.id)}
                >
                  {item.cover_id ? (
                    <img
                      className="canvas-thumb"
                      src={imageUrl(item.cover_id)}
                      alt=""
                    />
                  ) : (
                    <ImageIcon size={16} />
                  )}
                  <span>
                    {item.title === "Untitled session"
                      ? "Fresh canvas"
                      : item.title}
                  </span>
                </button>
                <div className="session-tools">
                  <button
                    aria-label={`Rename ${item.title}`}
                    onClick={() => setRename(item)}
                  >
                    <Pencil size={12} />
                  </button>
                  <button
                    aria-label={`Delete ${item.title}`}
                    onClick={() => setRemove(item)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="sidebar-foot">
          <Sparkles size={15} />
          <div>
            Keep the good ones.
            <small>Canvases are saved for this browser.</small>
          </div>
        </div>
      </aside>
      <main className="main">
        <div className="workspace-bar">
          <div>
            {!sidebar && (
              <button
                onClick={() => setSidebar(true)}
                aria-label="Expand sidebar"
              >
                <PanelLeftOpen size={17} />
              </button>
            )}
            <span>
              {canvas?.title === "Untitled session"
                ? "Fresh canvas"
                : canvas?.title || "Your next idea"}
            </span>
          </div>
          <div className="view-switch" aria-label="Canvas view">
            <button
              className={view === "images" ? "active" : ""}
              onClick={() => setView("images")}
              aria-pressed={view === "images"}
            >
              <LayoutGrid size={13} />
              <span>Images</span>
            </button>
            <button
              className={view === "chat" ? "active" : ""}
              onClick={() => setView("chat")}
              aria-pressed={view === "chat"}
            >
              <MessageSquare size={13} />
              <span>Conversation</span>
            </button>
          </div>
        </div>
        <div className="workspace-scroll">
          {jobs.length === 0 ? (
            <section className="empty-state playful-empty">
              <div className="playful-art" aria-hidden="true">
                <div className="doodle-card doodle-one">
                  <span>✳</span>
                </div>
                <div className="doodle-card doodle-two">
                  <span className="smile-eyes">••</span>
                  <span className="smile-mouth" />
                </div>
                <span className="doodle-spark">✧</span>
                <span className="doodle-caption">
                  a little spark goes a long way
                </span>
              </div>
              <span className="eyebrow">NO PERFECT PROMPTS REQUIRED.</span>
              <h1>Oh, the things you’ll make.</h1>
              <p>
                A wild idea. A tiny detail. A happy accident.
                <br />
                Give it a prompt and see where it goes.
              </p>
              <div className="idea-buttons">
                {[
                  {
                    label: "Make the ordinary odd",
                    prompt:
                      "A playful still life of a giant ceramic cherry on a tiny wooden chair. Warm studio light, unexpected scale, tactile materials.",
                  },
                  {
                    label: "Dream up a product",
                    prompt:
                      "A charming product photograph of a sculptural lamp shaped like a folded paper cloud. Soft shadows, warm white backdrop, thoughtful design.",
                  },
                  {
                    label: "Take me somewhere",
                    prompt:
                      "A tiny bookshop floating on a calm lake at dusk, warm windows, a small boat tied to the door, cinematic atmosphere.",
                  },
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      update({ prompt: item.prompt });
                      promptInput.current?.focus();
                    }}
                  >
                    {item.label}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            </section>
          ) : view === "images" ? (
            <div className="gallery">
              <div className="gallery-heading">
                <span>Your little collection</span>
                <small>
                  {outputs.length} {outputs.length === 1 ? "image" : "images"} ·
                  originals always saved
                </small>
              </div>
              <div className="image-grid">
                {outputs.map(resultCard)}
                {jobs
                  .filter((j) => j.status !== "completed")
                  .map((job) => (
                    <div
                      className={`gallery-status ${job.status === "failed" ? "failed" : ""}`}
                      key={job.id}
                    >
                      {job.status === "failed" ? (
                        <>
                          <RotateCcw size={22} />
                          <strong>That one didn’t land.</strong>
                          <p>{job.error}</p>
                          <button
                            onClick={() => {
                              restore(job);
                              setView("chat");
                            }}
                          >
                            Restore prompt & references
                          </button>
                        </>
                      ) : (
                        <>
                          <LoaderCircle className="spin" size={24} />
                          <strong>
                            {job.status === "queued"
                              ? "Your idea is in line."
                              : "A little magic in the making."}
                          </strong>
                          <p>
                            {job.count} {job.count === 1 ? "image" : "images"} ·{" "}
                            {job.status}
                          </p>
                        </>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div className="timeline">
              {jobs.map((job, index) => (
                <article className="generation" key={job.id}>
                  <div className="prompt-row">
                    <span className="prompt-avatar">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <div className="prompt-meta">
                        <strong>
                          {job.parent_id ? "A new take" : "Your idea"}
                        </strong>
                        <time>
                          {new Date(job.created).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      <p>{job.prompt}</p>
                      {job.refs.length > 0 && (
                        <div className="history-refs">
                          {job.refs.map((id, i) => (
                            <a
                              href={imageUrl(id)}
                              target="_blank"
                              rel="noreferrer"
                              key={id}
                            >
                              <img
                                src={imageUrl(id)}
                                alt={`Input reference ${i + 1}`}
                              />
                              <span>{i + 1}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="generation-content">
                    <div className="generation-meta">
                      <span>GPT Image 2</span>
                      <span>{job.size.replace("x", " × ")}</span>
                      <span>
                        {job.quality} · {job.count || 1}{" "}
                        {(job.count || 1) === 1 ? "image" : "images"}
                      </span>
                    </div>
                    {job.status === "completed" ? (
                      <div
                        className={`chat-outputs ${(job.outputs?.length || 1) > 1 ? "multiple" : ""}`}
                      >
                        {outputs
                          .filter((item) => item.id === job.id)
                          .map(resultCard)}
                      </div>
                    ) : job.status === "failed" ? (
                      <div className="failed-card">
                        <span>
                          Generation failed
                          {job.uncertain ? " · outcome uncertain" : ""}
                        </span>
                        <p>{job.error}</p>
                        <button onClick={() => restore(job)}>
                          <RotateCcw size={14} />
                          Restore prompt & references
                        </button>
                      </div>
                    ) : (
                      <div className="pending-card">
                        <LoaderCircle size={23} className="spin" />
                        <strong>
                          {job.status === "queued"
                            ? "Your idea is in line."
                            : "A little magic in the making."}
                        </strong>
                        <p>
                          You can close this canvas. Your images will be waiting
                          here.
                        </p>
                        <span>
                          {job.status === "queued" ? "Queued" : "Generating"} ·
                          No need to submit again
                        </span>
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <div className="composer-area">
          {me?.setupMessage && (
            <div className="setup-banner">
              <Sparkles size={15} />
              <span>{me.setupMessage}</span>
              <button
                onClick={async () => {
                  try {
                    const value = await api<Me>("bootstrap", "POST");
                    setMe(value);
                    if (value.user) await refreshCanvases();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Check again
                <ArrowUpRight size={13} />
              </button>
            </div>
          )}
          {error && (
            <div role="alert" className="error-banner">
              {error}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
          )}
          <div
            className="composer"
            onPaste={(e) => {
              const files = Array.from(e.clipboardData.files).filter((f) =>
                f.type.startsWith("image/"),
              );
              if (files.length) {
                e.preventDefault();
                void attach(files);
              }
            }}
          >
            {draft && draft.refs.length > 0 && (
              <div className="references">
                {draft.refs.map((id, index) => (
                  <div className="reference" key={id}>
                    <img src={imageUrl(id)} alt={`Reference ${index + 1}`} />
                    <span>{index + 1}</span>
                    <button
                      aria-label={`Remove reference ${index + 1}`}
                      disabled={uploading || busy}
                      onClick={() =>
                        update({
                          refs: draft.refs.filter((r) => r !== id),
                          parentId: index === 0 ? null : draft.parentId,
                        })
                      }
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
                {draft.parentId && (
                  <div className="editing-label">
                    <Pencil size={13} />
                    Editing image 1<small>The original stays saved.</small>
                  </div>
                )}
              </div>
            )}
            <textarea
              ref={promptInput}
              aria-label="Image prompt"
              placeholder={
                draft?.parentId
                  ? "What should we change?"
                  : "Describe the image you want to create…"
              }
              value={draft?.prompt || ""}
              maxLength={32000}
              disabled={busy}
              onChange={(e) => update({ prompt: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
            />
            <div className="composer-toolbar">
              <div className="settings">
                <button
                  className="attach-button"
                  disabled={busy || uploading || (draft?.refs.length || 0) >= 4}
                  onClick={() => fileInput.current?.click()}
                  title="Add reference images"
                  aria-label="Attach reference images"
                >
                  {uploading ? (
                    <LoaderCircle className="spin" size={18} />
                  ) : (
                    <ImagePlus size={18} />
                  )}
                </button>
                <span className="toolbar-divider" />
                <span className="model-label">
                  <Sparkles size={14} />
                  GPT Image 2
                </span>
                <SettingMenu
                  label="Aspect ratio"
                  value={draft?.size || "1024x1024"}
                  disabled={busy}
                  icon={<span className="ratio-icon" />}
                  onChange={(size) => update({ size })}
                  options={(
                    model?.sizes || [
                      { value: "1024x1024", label: "Square", ratio: "1:1" },
                    ]
                  ).map((size) => ({
                    value: size.value,
                    label: `${size.label} · ${size.ratio}`,
                    detail: `${size.value.replace("x", " × ")} px`,
                  }))}
                />
                <SettingMenu
                  label="Quality"
                  value={draft?.quality || "medium"}
                  disabled={busy}
                  icon={<Settings2 size={14} />}
                  onChange={(quality) => update({ quality })}
                  options={(model?.qualities || ["medium", "high"]).map(
                    (quality) => ({
                      value: quality,
                      label: quality[0].toUpperCase() + quality.slice(1),
                      detail:
                        quality === "high"
                          ? "More detail, higher cost"
                          : "Great detail, balanced cost",
                    }),
                  )}
                />
                <SettingMenu
                  label="Image count"
                  value={String(draft?.count || 1)}
                  disabled={busy}
                  icon={<Layers3 size={14} />}
                  onChange={(count) => update({ count: Number(count) })}
                  options={[1, 2, 3, 4].map((n) => ({
                    value: String(n),
                    label: `${n} ${n === 1 ? "image" : "images"}`,
                  }))}
                />
              </div>
              <button
                className="generate-button"
                disabled={
                  !loaded ||
                  !me?.user ||
                  busy ||
                  uploading ||
                  !draft?.prompt.trim() ||
                  !!me.setupMessage ||
                  pending
                }
                onClick={() => void submit()}
              >
                {busy ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <ArrowUp size={17} />
                )}
                <span>
                  {busy
                    ? "Sending…"
                    : draft?.parentId
                      ? "Generate edit"
                      : "Generate"}
                </span>
              </button>
            </div>
          </div>
          <div className="composer-caption">
            <span>
              {(draft?.size || "1024x1024").replace("x", " × ")} px
              <span className="caption-dot">·</span>Up to 4 references
              <span className="caption-dot">·</span>Each image uses API credits
            </span>
            <span className="keyboard-hint">⌘ / Ctrl + Enter</span>
          </div>
          <input
            ref={fileInput}
            hidden
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              void attach(Array.from(e.target.files || []));
              e.target.value = "";
            }}
          />
        </div>
      </main>
      {drag && (
        <div className="drop-overlay" onDragLeave={() => setDrag(false)}>
          <ImagePlus size={38} />
          <h2>A little inspiration? Drop it here.</h2>
          <p>Up to 4 PNG, JPEG, or WebP images · 4 MB each</p>
        </div>
      )}
      {toast && (
        <div role="status" className="toast">
          <Check size={15} />
          {toast}
        </div>
      )}
      {preview && (
        <div
          className="modal-overlay preview-overlay"
          onClick={() => setPreview(null)}
        >
          <section
            className="preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <span>
                Original image · {preview.width} × {preview.height}
              </span>
              <button
                onClick={() => setPreview(null)}
                aria-label="Close preview"
              >
                <X size={20} />
              </button>
            </div>
            <img
              className="preview-image"
              src={imageUrl(preview.result_id!)}
              alt={preview.prompt}
            />
            <p>{preview.prompt}</p>
            {actions(preview)}
            <a
              className="original-link"
              href={`${imageUrl(preview.result_id!)}?download=1`}
            >
              <Download size={14} />
              Download Original
            </a>
          </section>
        </div>
      )}
      {rename && (
        <div className="modal-overlay">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Rename canvas"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api(`sessions/${rename.id}`, "PATCH", {
                  title: new FormData(e.currentTarget).get("title"),
                });
                await refreshCanvases();
              } catch (err) {
                setError((err as Error).message);
              }
              setRename(null);
            }}
          >
            <h2>Give it a name.</h2>
            <label>
              Canvas name
              <input
                name="title"
                defaultValue={rename.title}
                maxLength={80}
                required
              />
            </label>
            <div className="dialog-actions">
              <button type="button" onClick={() => setRename(null)}>
                Cancel
              </button>
              <button className="primary">Save name</button>
            </div>
          </form>
        </div>
      )}
      {remove && (
        <div className="modal-overlay">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Delete canvas"
          >
            <h2>Let this one go?</h2>
            <p>
              “{remove.title}” and all its images will be permanently deleted.
            </p>
            <div className="dialog-actions">
              <button onClick={() => setRemove(null)}>Keep canvas</button>
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await api(`sessions/${remove.id}`, "DELETE");
                    if (me?.user)
                      localStorage.removeItem(
                        `studio:${me.user.id}:${remove.id}`,
                      );
                    if (canvasId === remove.id) openCanvas(null);
                    await refreshCanvases();
                  } catch (e) {
                    setError((e as Error).message);
                  }
                  setRemove(null);
                }}
              >
                Delete canvas
              </button>
            </div>
          </section>
        </div>
      )}
      {regenerate && (
        <div className="modal-overlay">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Regenerate image"
          >
            <h2>Another take?</h2>
            <p>
              This sends a new paid request to OpenAI for{" "}
              {regenerate.count || 1}{" "}
              {(regenerate.count || 1) === 1 ? "image" : "images"}. Your
              previous versions stay saved.
            </p>
            <div className="dialog-actions">
              <button onClick={() => setRegenerate(null)}>Cancel</button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  const job = regenerate;
                  setRegenerate(null);
                  setPreview(null);
                  void submit({
                    prompt: job.prompt,
                    model: job.model,
                    size: job.size,
                    quality: job.quality,
                    count: job.count || 1,
                    refs: job.refs,
                    parentId: job.parent_id,
                    key: crypto.randomUUID(),
                  });
                }}
              >
                Regenerate
                <RotateCcw size={15} />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
