const ID = "lipatos-buffs-debuffs";
const ENC = "lipatos-encumbrance";
const ICON_SIZE = 32; // Size of item icons in the inventory shown on the user's character sheet.
const roots = new Map();

function actualElement(html, app) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  if (app?.element instanceof HTMLElement) return app.element;
  if (app?.element?.[0] instanceof HTMLElement) return app.element[0];
  return null;
}
function actorOf(app) {
  const actor = app?.actor ?? app?.document;
  return actor?.documentName === "Actor" ? actor : null;
}
function plain(value) {
  const element = document.createElement("div");
  element.innerHTML = String(value ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|h[1-6])>/gi, "\n");
  return (element.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}
function storedDescription(doc) {
  if (!doc) return "";
  const fields = [doc.description, doc.system?.description?.value, doc.system?.description,
    doc.system?.details?.description, doc.flags?.dnd5e?.description];
  return fields.find(v => typeof v === "string" && v.trim()) ?? "";
}
async function resolveEffectDescription(effect, actor) {
  let raw = storedDescription(effect), source = effect;
  if (!raw) {
    const origins = [effect.item, effect.parent?.documentName === "Item" ? effect.parent : null];
    for (const uuid of [effect.system?.origin?.item, effect.system?.origin?.activity,
      effect.system?.origin?.effect, effect.origin]) {
      if (!uuid || typeof uuid !== "string") continue;
      try { const doc = fromUuidSync(uuid, {strict: false}); if (doc) origins.push(doc); }
      catch { /* source is inaccessible */ }
    }
    if (typeof effect.getSource === "function") {
      try { origins.push(await effect.getSource()); } catch { /* source is inaccessible */ }
    }
    const name = String(effect.name ?? "").trim().toLocaleLowerCase();
    const sourceName = String(effect.sourceName ?? "").trim().toLocaleLowerCase();
    for (const item of actor?.items ?? []) {
      const n = String(item.name ?? "").trim().toLocaleLowerCase();
      if (n === name || (sourceName && n === sourceName)) origins.push(item);
    }
    for (const candidate of origins) {
      if (!candidate) continue;
      const doc = candidate.documentName === "ActiveEffect"
        ? (candidate.item ?? (candidate.parent?.documentName === "Item" ? candidate.parent : null))
        : candidate;
      raw = storedDescription(doc);
      if (raw) { source = doc; break; }
    }
  }
  if (!raw) {
    const statusId = effect.system?.type ?? (effect.statuses ? [...effect.statuses][0] : null);
    const status = (CONFIG.statusEffects ?? []).find(s =>
      s.id === statusId || s._id === effect.id || s.name === effect.name || s.label === effect.name);
    raw = status?.description ?? "";
    if (typeof raw === "string" && game.i18n?.has?.(raw)) raw = game.i18n.localize(raw);
  }
  if (!raw) return "";
  try {
    const enriched = await foundry.applications.ux.TextEditor.implementation.enrichHTML(raw, {
      async: true, relativeTo: source ?? actor,
      secrets: Boolean(actor?.isOwner), rollData: actor?.getRollData?.() ?? {}
    });
    if (plain(enriched)) return plain(enriched);
  } catch { /* fallback to source text */ }
  return plain(raw);
}
function collect(actor) {
  let all = [];
  try {
    const applicable = actor.allApplicableEffects?.();
    all = applicable ? Array.from(applicable) : Array.from(actor.effects ?? []);
  } catch {
    all = Array.from(actor.effects ?? []);
  }
  const seen = new Set();
  return all.filter(effect => {
    if (!effect || effect.disabled || effect.isSuppressed || seen.has(effect.uuid)) return false;
    seen.add(effect.uuid);
    return true;
  });
}
function iconFor(effect) {
  return effect.img || effect.icon || "icons/svg/aura.svg";
}
function createIcon(effect, actor) {
  const holder = document.createElement("div");
  holder.className = "lipatos-bd-icon";
  holder.tabIndex = 0;
  holder.setAttribute("role", "img");
  holder.setAttribute("aria-label", effect.name || "Эффект");
  const image = document.createElement("img");
  image.src = iconFor(effect);
  image.width = ICON_SIZE;
  image.height = ICON_SIZE;
  image.draggable = false;
  holder.append(image);
  const tooltip = document.createElement("div");
  tooltip.className = "lipatos-bd-tooltip";
  const label = document.createElement("div");
  label.className = "lipatos-bd-tooltip-title";
  label.textContent = effect.name || "Без названия";
  const description = document.createElement("div");
  description.className = "lipatos-bd-tooltip-body";
  description.textContent = "Загрузка описания…";
  resolveEffectDescription(effect, actor).then(value => {
    if (holder.isConnected) description.textContent = value || "Описание отсутствует в источнике эффекта.";
  }).catch(error => {
    console.warn("LipatoS: не удалось получить описание эффекта", error);
    if (holder.isConnected) description.textContent = "Описание недоступно.";
  });
  tooltip.append(label, description);
  // Render the popup at body level so horizontal scrolling cannot clip it.
  const show = () => {
    const r = holder.getBoundingClientRect();
    tooltip.style.top = Math.max(8, Math.min(window.innerHeight - 125, r.bottom + 8)) + "px";
    tooltip.style.left = Math.max(8, Math.min(window.innerWidth - 355, r.left)) + "px";
    document.body.appendChild(tooltip);
    tooltip.classList.add("lipatos-bd-portal");
  };
  const hide = () => tooltip.remove();
  holder.addEventListener("mouseenter", show);
  holder.addEventListener("mouseleave", hide);
  holder.addEventListener("focus", show);
  holder.addEventListener("blur", hide);
  return holder;
}
function activeTurnActor(actor) {
  const combat = game.combat;
  const c = combat?.combatant;
  if (!combat?.started || !c) return null;
  const token = canvas?.tokens?.controlled?.find(t => t.actor?.id === actor.id && t.document.combatant?.id === c.id);
  return token?.document ?? null;
}
function renderBar(actor, root) {
  const existing = root.querySelector(".lipatos-bd-bar");
  if (existing) existing.remove();
  document.querySelectorAll(".lipatos-bd-portal").forEach(el => el.remove());
  const effects = collect(actor);
  const enc = game.modules.get(ENC)?.active ? game.modules.get(ENC)?.api : null;
  const token = enc ? activeTurnActor(actor) : null;
  if (!effects.length && !token) return;
  const bar = document.createElement("div");
  bar.className = "lipatos-bd-bar";
  bar.dataset.actorId = actor.id;
  const badges = document.createElement("div");
  badges.className = "lipatos-bd-icons";
  for (const effect of effects) badges.append(createIcon(effect, actor));
  bar.append(badges);
  if (token && !game.user.isGM && token.isOwner) {
    const move = document.createElement("div");
    move.className = "lipatos-bd-movement";
    const walk = enc.getSpeed(actor);
    move.textContent = "Скорость: " + walk + " | " + (enc.dashUsed(token) ? "Рывок использован" : "Действие свободно");
    const dash = document.createElement("button");
    dash.type = "button";
    dash.className = "lipatos-bd-dash";
    dash.textContent = "Рывок";
    dash.disabled = !enc.canDash(token);
    dash.title = dash.disabled ? "Рывок уже использован или скорость равна 0" : "Потратить действие: увеличить доступное перемещение на свою скорость до конца хода";
    dash.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      try { await enc.useDash(token); }
      catch (err) { ui.notifications.error("Не удалось выполнить «Рывок»."); console.error(err); }
      renderBar(actor, root);
    });
    move.append(dash);
    bar.append(move);
  }
  root.append(bar);
  positionBar(root, bar);
  watchPortrait(root);
}
/** Align the 32px icons precisely 2px above the portrait's upper border. */
function positionBar(root, bar = root.querySelector(".lipatos-bd-bar")) {
  if (!bar) return;
  const portrait = root.querySelector(".sidebar .portrait");
  if (!portrait) {
    bar.style.top = "143px";  // fallback for a custom character sheet
    return;
  }
  const p = portrait.getBoundingClientRect();
  const r = root.getBoundingClientRect();
  if (!p.height || !r.height) return;
  bar.style.top = (p.top - r.top + root.scrollTop - ICON_SIZE - 2) + "px";
}
const portraitObservers = new WeakMap();
function watchPortrait(root) {
  const portrait = root.querySelector(".sidebar .portrait");
  if (!portrait || typeof ResizeObserver === "undefined") return;
  const previous = portraitObservers.get(root);
  if (previous?.portrait === portrait) return;
  previous?.observer.disconnect();
  const observer = new ResizeObserver(() => positionBar(root));
  observer.observe(root);
  observer.observe(portrait);
  const header = root.querySelector(".sheet-header");
  if (header) observer.observe(header);
  portraitObservers.set(root, {portrait, observer});
}
function onSheet(app, html) {
  if (game.system.id !== "dnd5e") return;
  const actor = actorOf(app);
  if (!actor || actor.type !== "character") return;
  const el = actualElement(html, app);
  if (!el) return;
  const sheet = el.matches(".dnd5e2.sheet.actor") ? el : el.closest(".dnd5e2.sheet.actor") ?? el.querySelector(".dnd5e2.sheet.actor");
  if (!sheet) return;
  const root = sheet.querySelector(".window-content") ?? sheet;
  root.classList.add("lipatos-bd-parent");
  const previous = roots.get(actor.uuid);
  if (previous?.root && previous.root !== root) {
    portraitObservers.get(previous.root)?.observer.disconnect();
  }
  roots.set(actor.uuid, {actor, root});
  renderBar(actor, root);
}
function refresh(actor) {
  if (!actor) return;
  for (const [uuid, entry] of roots) {
    if (!entry.root.isConnected) {
      portraitObservers.get(entry.root)?.observer.disconnect();
      roots.delete(uuid);
      continue;
    }
    if (entry.actor.id === actor.id) renderBar(actor, entry.root);
  }
}
Hooks.on("renderApplicationV2", onSheet);
Hooks.on("renderActorSheet", onSheet);
Hooks.on("createActiveEffect", e => refresh(e.parent));
Hooks.on("updateActiveEffect", e => refresh(e.parent));
Hooks.on("deleteActiveEffect", e => refresh(e.parent));
Hooks.on("updateActor", refresh);
for (const action of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(action, item => {
    if (item.parent?.documentName === "Actor") refresh(item.parent);
  });
}
Hooks.on("controlToken", t => {if(t?.actor) refresh(t.actor);});
Hooks.on("updateCombat", () => {for(const e of roots.values()) if(e.root.isConnected) renderBar(e.actor, e.root);});
Hooks.on("updateCombatant", () => {for(const e of roots.values()) if(e.root.isConnected) renderBar(e.actor, e.root);});
Hooks.once("ready", () => {console.info("LipatoS — Баффы и дебаффы: панель эффектов активирована.");});
