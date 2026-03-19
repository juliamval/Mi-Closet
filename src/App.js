import { useState, useEffect, useRef, useCallback } from "react";

const CATEGORIES = ["Todos", "Tops", "Bottoms", "Vestidos", "Abrigos", "Zapatos", "Accesorios", "Otro"];
const CAT_EMOJI = { Todos: "✦", Tops: "👕", Bottoms: "👖", Vestidos: "👗", Abrigos: "🧥", Zapatos: "👟", Accesorios: "👜", Otro: "✨" };

// ── IndexedDB storage ─────────────────────────────────────────────────────
const DB_NAME = "mi-closet-db";
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore("items", { keyPath: "id" });
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readonly");
    const req = tx.objectStore("items").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbPut(item) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");
    tx.objectStore("items").put(item);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
async function dbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("items", "readwrite");
    tx.objectStore("items").delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ── Gemini API ────────────────────────────────────────────────────────────
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.REACT_APP_GEMINI_KEY}`;

async function analyzeClothingItem(imageBase64) {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: "image/jpeg", data: imageBase64 } },
          { text: `Analiza esta prenda de ropa y devuelve SOLO un JSON válido sin markdown ni backticks:\n{"name":"nombre descriptivo en español","category":"uno de exactamente: Tops|Bottoms|Vestidos|Abrigos|Zapatos|Accesorios|Otro","color":"color(es) principal(es)","style":"casual|formal|deportivo|elegante|urbano|bohemio","season":"Primavera/Verano|Otoño/Invierno|Todo el año","description":"descripción corta máximo 15 palabras"}` }
        ]
      }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 300 }
    })
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(text); }
  catch { const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error("No se pudo leer la respuesta"); }
}

async function getOutfitRecommendations(items) {
  const parts = [];
  items.slice(0, 10).forEach((item, i) => {
    parts.push({ inline_data: { mime_type: "image/jpeg", data: item.imageData } });
    parts.push({ text: `[${i + 1}] ${item.name} — ${item.category}, ${item.color}, ${item.style}` });
  });
  parts.push({ text: `Con estas prendas crea 3 outfits. SOLO JSON sin markdown:\n{"outfits":[{"nombre":"nombre creativo","ocasion":"para qué ocasión","prendas":[1,2,3],"descripcion":"por qué funciona este look en 15 palabras","tip":"consejo de estilo corto"}]}` });

  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 800 }
    })
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates[0].content.parts[0].text.replace(/```json|```/g, "").trim();
  try { return JSON.parse(text); }
  catch { const m = text.match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); throw new Error("No se pudo leer los outfits"); }
}

// ── Image compression ─────────────────────────────────────────────────────
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      const MAX = 600;
      let w = img.width, h = img.height;
      if (w > h && w > MAX) { h = Math.round((h * MAX) / w); w = MAX; }
      else if (h > MAX) { w = Math.round((w * MAX) / h); h = MAX; }
      canvas.width = w; canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.7).split(",")[1]);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function catColor(cat) {
  const map = { Tops: "#2a4a3e", Bottoms: "#3a2a4e", Vestidos: "#4e2a3a", Abrigos: "#3a3a2a", Zapatos: "#2a3a4e", Accesorios: "#4e3a2a", Otro: "#2a2a2a" };
  return map[cat] || "#2a2a2a";
}

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Jost:wght@300;400;500;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #0d0d0d; -webkit-font-smoothing: antialiased; }
  .vc-root { font-family: 'Jost', sans-serif; background: #0d0d0d; min-height: 100vh; min-height: 100dvh; color: #f0ebe0; }
  .fade-in { animation: fadeIn 0.4s ease; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  .spinner { width: 32px; height: 32px; border-radius: 50%; border: 2px solid rgba(201,168,76,0.2); border-top-color: #c9a84c; animation: spin 0.8s linear infinite; display: block; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .card-hover { cursor: pointer; transition: transform 0.2s ease; }
  .card-hover:active { transform: scale(0.97); }
  .card-overlay { opacity: 0; transition: opacity 0.2s; }
  .dropzone-area { cursor: pointer; transition: all 0.25s ease; -webkit-tap-highlight-color: transparent; }
  .modal-in { animation: modalIn 0.3s cubic-bezier(0.34,1.56,0.64,1); }
  @keyframes modalIn { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: none; } }
  .pulse { animation: pulse 2s ease infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
  .nav-btn { background: none; border: none; color: #555; padding: 10px 14px; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; cursor: pointer; font-family: 'Jost', sans-serif; font-weight: 500; border-bottom: 2px solid transparent; transition: all 0.2s; -webkit-tap-highlight-color: transparent; }
  .nav-btn.active { color: #c9a84c; border-bottom-color: #c9a84c; }
  .cat-btn { background: none; border: 1px solid #222; color: #666; padding: 6px 12px; border-radius: 40px; font-size: 11px; cursor: pointer; font-family: 'Jost', sans-serif; transition: all 0.2s; display: flex; align-items: center; gap: 4px; white-space: nowrap; -webkit-tap-highlight-color: transparent; }
  .cat-btn.active { border-color: #c9a84c; color: #c9a84c; background: rgba(201,168,76,0.08); }
  .outfit-btn { background: #c9a84c; border: none; color: #0d0d0d; padding: 13px 28px; border-radius: 40px; font-size: 11px; letter-spacing: 0.2em; text-transform: uppercase; cursor: pointer; font-family: 'Jost', sans-serif; font-weight: 600; -webkit-tap-highlight-color: transparent; }
  .outfit-btn:disabled { background: #222; color: #444; cursor: not-allowed; }
  .delete-btn { background: none; border: 1px solid #2a1515; color: #664444; padding: 8px 16px; border-radius: 8px; font-size: 11px; cursor: pointer; font-family: 'Jost', sans-serif; margin-top: auto; align-self: flex-start; }
  .modal-close { position: absolute; top: 14px; right: 14px; background: rgba(0,0,0,0.6); border: none; color: #888; width: 30px; height: 30px; border-radius: 15px; font-size: 13px; cursor: pointer; z-index: 10; }
  .empty-btn { margin-top: 14px; background: none; border: 1px solid #333; color: #888; padding: 10px 22px; border-radius: 40px; font-size: 11px; letter-spacing: 0.12em; cursor: pointer; font-family: 'Jost', sans-serif; }
  .error-box { background: rgba(180,50,50,0.1); border: 1px solid rgba(180,50,50,0.3); border-radius: 10px; padding: 12px 14px; font-size: 12px; color: #c87878; line-height: 1.5; margin-top: 12px; }
  ::-webkit-scrollbar { width: 3px; }
  ::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
`;

export default function VirtualCloset() {
  const [items, setItems] = useState([]);
  const [tab, setTab] = useState("closet");
  const [category, setCategory] = useState("Todos");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [outfits, setOutfits] = useState([]);
  const [loadingOutfits, setLoadingOutfits] = useState(false);
  const [outfitError, setOutfitError] = useState("");
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [outfitDone, setOutfitDone] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    dbGetAll().then(setItems).catch(console.error).finally(() => setLoaded(true));
  }, []);

  async function handleFiles(files) {
    if (!files.length || uploading) return;
    setUploading(true); setUploadError("");
    const added = [];
    for (let i = 0; i < files.length; i++) {
      if (!files[i].type.startsWith("image/")) continue;
      setProgress(`Analizando prenda ${i + 1} de ${files.length}...`);
      try {
        const imageData = await compressImage(files[i]);
        const info = await analyzeClothingItem(imageData);
        const item = { id: `${Date.now()}_${i}`, imageData, ...info };
        await dbPut(item);
        added.push(item);
        setItems((p) => [...p, item]);
      } catch (e) { console.error(e); setUploadError(`Error: ${e.message}`); }
    }
    setUploading(false); setProgress("");
    if (added.length) { setUploadError(""); setTab("closet"); }
  }

  async function deleteItem(id) {
    await dbDelete(id);
    setItems((p) => p.filter((i) => i.id !== id));
    setSelected(null);
  }

  async function handleGetOutfits() {
    if (items.length < 2) return;
    setLoadingOutfits(true); setOutfits([]); setOutfitDone(false); setOutfitError("");
    try {
      const r = await getOutfitRecommendations(items);
      setOutfits(r.outfits || []); setOutfitDone(true);
    } catch (e) { setOutfitError("Error: " + e.message); }
    setLoadingOutfits(false);
  }

  const filtered = category === "Todos" ? items : items.filter((i) => i.category === category);
  const onDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false);
    handleFiles(Array.from(e.dataTransfer.files));
  }, [uploading]);

  return (
    <div className="vc-root">
      <style>{css}</style>

      <header style={{ borderBottom: "1px solid #1a1a1a", position: "sticky", top: 0, zIndex: 100, background: "rgba(13,13,13,0.97)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px 10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 20, color: "#c9a84c" }}>✦</span>
            <div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, fontWeight: 600, letterSpacing: "0.15em" }}>MI CLOSET</div>
              <div style={{ fontSize: 8, letterSpacing: "0.3em", color: "#555", textTransform: "uppercase" }}>Virtual Wardrobe</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {[["prendas", items.length], ["outfits", outfits.length]].map(([label, num]) => (
              <div key={label} style={{ textAlign: "center" }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, color: "#c9a84c" }}>{num}</div>
                <div style={{ fontSize: 8, letterSpacing: "0.2em", color: "#555", textTransform: "uppercase" }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
        <nav style={{ display: "flex", padding: "0 12px", overflowX: "auto" }}>
          {[["closet", "Mi Closet"], ["upload", "Agregar"], ["outfits", "Outfits IA"]].map(([t, l]) => (
            <button key={t} className={`nav-btn${tab === t ? " active" : ""}`} onClick={() => setTab(t)}>{l}</button>
          ))}
        </nav>
      </header>

      <main style={{ maxWidth: 700, margin: "0 auto", padding: "20px 14px", paddingBottom: 40 }}>

        {/* CLOSET */}
        {tab === "closet" && (
          <div className="fade-in">
            <div style={{ display: "flex", gap: 7, overflowX: "auto", paddingBottom: 10, marginBottom: 18 }}>
              {CATEGORIES.map((c) => (
                <button key={c} className={`cat-btn${category === c ? " active" : ""}`} onClick={() => setCategory(c)}>
                  {CAT_EMOJI[c]} {c}
                </button>
              ))}
            </div>
            {!loaded ? (
              <div style={{ display: "flex", justifyContent: "center", paddingTop: 80 }}><div className="spinner" /></div>
            ) : filtered.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "55vh", gap: 10, textAlign: "center" }}>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 44, color: "#222" }}>✦</div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 22, color: "#444" }}>{items.length === 0 ? "Tu closet está vacío" : "Sin prendas aquí"}</div>
                <div style={{ fontSize: 12, color: "#444" }}>{items.length === 0 ? "Agrega fotos de tu ropa para comenzar" : "Prueba otra categoría"}</div>
                {items.length === 0 && <button className="empty-btn" onClick={() => setTab("upload")}>Agregar ropa →</button>}
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
                {filtered.map((item) => (
                  <div key={item.id} className="card-hover" onClick={() => setSelected(item)}
                    style={{ background: "#111", borderRadius: 12, overflow: "hidden", border: "1px solid #1a1a1a" }}>
                    <div style={{ position: "relative", aspectRatio: "3/4", overflow: "hidden" }}>
                      <img src={`data:image/jpeg;base64,${item.imageData}`} alt={item.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    </div>
                    <div style={{ padding: "9px 11px 11px" }}>
                      <div style={{ fontSize: 11, color: "#d0c8b8", marginBottom: 5, lineHeight: 1.3 }}>{item.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 8, padding: "2px 6px", borderRadius: 20, background: catColor(item.category), color: "#aaa", letterSpacing: "0.08em", textTransform: "uppercase" }}>{item.category}</span>
                        <span style={{ fontSize: 9, color: "#555" }}>{item.color}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* UPLOAD */}
        {tab === "upload" && (
          <div className="fade-in" style={{ maxWidth: 500, margin: "0 auto" }}>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 300, marginBottom: 8 }}>Agrega tus prendas</div>
              <div style={{ fontSize: 12, color: "#555", lineHeight: 1.7 }}>Sube fotos y la IA las clasificará automáticamente.</div>
            </div>
            <div className="dropzone-area"
              style={{ border: `1px dashed ${dragging ? "#c9a84c" : "#2a2a2a"}`, borderRadius: 14, minHeight: 220, display: "flex", alignItems: "center", justifyContent: "center", background: dragging ? "rgba(201,168,76,0.06)" : "#0a0a0a" }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !uploading && fileRef.current.click()}>
              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={(e) => handleFiles(Array.from(e.target.files))} />
              {uploading ? (
                <div style={{ textAlign: "center", padding: 36, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
                  <div className="spinner" style={{ width: 40, height: 40, borderWidth: 3 }} />
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 17, color: "#c9a84c" }}>{progress}</div>
                  <div style={{ fontSize: 11, color: "#555" }}>Puede tardar unos segundos...</div>
                </div>
              ) : (
                <div style={{ textAlign: "center", padding: 32, display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 38, color: "#252525", marginBottom: 2 }}>↑</div>
                  <div style={{ fontSize: 14, color: "#666", fontWeight: 300 }}>Toca para subir fotos</div>
                  <div style={{ fontSize: 9, color: "#444", letterSpacing: "0.2em", marginTop: 2 }}>JPG · PNG · HEIC</div>
                </div>
              )}
            </div>
            {uploadError && <div className="error-box">⚠️ {uploadError}</div>}
          </div>
        )}

        {/* OUTFITS */}
        {tab === "outfits" && (
          <div className="fade-in">
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 300, marginBottom: 8 }}>Outfits con IA</div>
              <div style={{ fontSize: 12, color: "#555", marginBottom: 18 }}>{items.length} prenda{items.length !== 1 ? "s" : ""} en tu closet</div>
              <button className="outfit-btn" onClick={handleGetOutfits} disabled={items.length < 2 || loadingOutfits}>
                {loadingOutfits ? "Creando outfits..." : items.length < 2 ? "Agrega más prendas" : "✦ Crear Outfits"}
              </button>
              {outfitError && <div className="error-box" style={{ textAlign: "left", marginTop: 14 }}>⚠️ {outfitError}</div>}
            </div>
            {loadingOutfits && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 48, gap: 14 }}>
                <div className="spinner" style={{ width: 44, height: 44, borderWidth: 3 }} />
                <div style={{ fontSize: 12, color: "#555" }}>Analizando tu closet...</div>
              </div>
            )}
            {outfits.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {outfits.map((outfit, oi) => {
                  const outfitItems = (outfit.prendas || []).map((idx) => items[idx - 1]).filter(Boolean);
                  return (
                    <div key={oi} style={{ background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: 14, padding: "18px 16px" }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 14 }}>
                        <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 36, fontWeight: 300, color: "#1e1e1e", lineHeight: 1, flexShrink: 0 }}>0{oi + 1}</div>
                        <div>
                          <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 18, marginBottom: 3 }}>{outfit.nombre}</div>
                          <div style={{ fontSize: 9, color: "#c9a84c", letterSpacing: "0.12em", textTransform: "uppercase" }}>{outfit.ocasion}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                        {outfitItems.map((item, ii) => (
                          <div key={ii} style={{ textAlign: "center" }}>
                            <img src={`data:image/jpeg;base64,${item.imageData}`} alt={item.name}
                              style={{ width: 76, height: 100, objectFit: "cover", borderRadius: 8, display: "block", marginBottom: 4, border: "1px solid #1a1a1a" }} />
                            <div style={{ fontSize: 8, color: "#555", maxWidth: 76, lineHeight: 1.3 }}>{item.name}</div>
                          </div>
                        ))}
                      </div>
                      <p style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginBottom: 10 }}>{outfit.descripcion}</p>
                      <div style={{ display: "flex", gap: 8, background: "rgba(201,168,76,0.06)", border: "1px solid rgba(201,168,76,0.15)", borderRadius: 8, padding: "9px 12px" }}>
                        <span style={{ color: "#c9a84c", flexShrink: 0 }}>✦</span>
                        <span style={{ fontSize: 11, color: "#888" }}>{outfit.tip}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {!loadingOutfits && outfits.length === 0 && !outfitDone && items.length >= 2 && (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 48, gap: 10, textAlign: "center" }}>
                <div className="pulse" style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 44, color: "#222" }}>✦</div>
                <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, color: "#444" }}>Listo para crear outfits</div>
                <div style={{ fontSize: 11, color: "#444" }}>Toca el botón de arriba para comenzar</div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* MODAL */}
      {selected && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 200, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
          onClick={() => setSelected(null)}>
          <div className="modal-in" style={{ background: "#0f0f0f", border: "1px solid #1e1e1e", borderRadius: "20px 20px 0 0", width: "100%", maxWidth: 500, maxHeight: "85vh", overflow: "hidden", position: "relative", display: "flex" }}
            onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelected(null)}>✕</button>
            <div style={{ width: 160, flexShrink: 0 }}>
              <img src={`data:image/jpeg;base64,${selected.imageData}`} alt={selected.name}
                style={{ width: "100%", height: "100%", minHeight: 200, objectFit: "cover", display: "block" }} />
            </div>
            <div style={{ padding: "22px 18px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ fontSize: 9, color: "#c9a84c", letterSpacing: "0.2em", textTransform: "uppercase" }}>{CAT_EMOJI[selected.category]} {selected.category}</div>
              <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 20, lineHeight: 1.2 }}>{selected.name}</div>
              <p style={{ fontSize: 11, color: "#555", lineHeight: 1.6 }}>{selected.description}</p>
              <div style={{ borderTop: "1px solid #1a1a1a", paddingTop: 10, display: "flex", flexDirection: "column", gap: 7 }}>
                {[["Color", selected.color], ["Estilo", selected.style], ["Temporada", selected.season]].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ fontSize: 9, color: "#444", letterSpacing: "0.12em", textTransform: "uppercase" }}>{k}</span>
                    <span style={{ fontSize: 11, color: "#888" }}>{v}</span>
                  </div>
                ))}
              </div>
              <button className="delete-btn" onClick={() => deleteItem(selected.id)}>Eliminar prenda</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
