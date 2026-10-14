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
  element.innerHTML = String(value || "");
  return element.textContent?.trim() || "Описание отсутствует.";
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
function createIcon(effect) {
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
  description.textContent = plain(effect.description);
  tooltip.append(label, description);
  holder.append(tooltip);
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
  const effects = collect(actor);
  const enc = game.modules.get(ENC)?.active ? game.modules.get(ENC)?.api : null;
  const token = enc ? activeTurnActor(actor) : null;
  if (!effects.length && !token) return;
  const bar = document.createElement("div");
  bar.className = "lipatos-bd-bar";
  bar.dataset.actorId = actor.id;
  const badges = document.createElement("div");
  badges.className = "lipatos-bd-icons";
  for (const effect of effects) badges.append(createIcon(effect));
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
  roots.set(actor.uuid, {actor, root});
  renderBar(actor, root);
}
function refresh(actor) {
  if (!actor) return;
  for (const [uuid, entry] of roots) {
    if (!entry.root.isConnected) { roots.delete(uuid); continue; }
    if (entry.actor.id === actor.id) renderBar(actor, entry.root);
  }
}
Hooks.on("renderApplicationV2", onSheet);
Hooks.on("renderActorSheet", onSheet);
Hooks.on("createActiveEffect", e => refresh(e.parent));
Hooks.on("updateActiveEffect", e => refresh(e.parent));
Hooks.on("deleteActiveEffect", e => refresh(e.parent));
Hooks.on("updateActor", refresh);
Hooks.on("controlToken", t => {if(t?.actor) refresh(t.actor);});
Hooks.on("updateCombat", () => {for(const e of roots.values()) if(e.root.isConnected) renderBar(e.actor, e.root);});
Hooks.on("updateCombatant", () => {for(const e of roots.values()) if(e.root.isConnected) renderBar(e.actor, e.root);});
Hooks.once("ready", () => {console.info("LipatoS — Баффы и дебаффы: панель эффектов активирована.");});
