function q(id) {
  return document.getElementById(id);
}

function safeText(value) {
  return String(value || "").trim();
}

function firstChar(value) {
  const arr = Array.from(safeText(value));
  return arr.length ? arr[0] : "";
}

function normalizeTheme(value) {
  return safeText(value).toLowerCase() === "light" ? "light" : "dark";
}

const pageState = {
  serverUrl: "",
  token: "",
  username: "",
  profile: {
    username: "",
    displayName: "",
    bio: "",
    avatar: "",
  },
};

function setStateText(text) {
  const node = q("p_state");
  if (node) node.textContent = text;
}

async function syncWindowMaxButton() {
  const btn = q("p_btn_max");
  if (!btn || !window.api?.isWindowMaximized) return;

  try {
    const maximized = await window.api.isWindowMaximized();
    btn.dataset.maximized = maximized ? "true" : "false";
    btn.title = maximized ? "恢复窗口" : "最大化";
    btn.setAttribute("aria-label", maximized ? "恢复窗口" : "最大化");
  } catch {
    btn.dataset.maximized = "false";
    btn.title = "最大化";
    btn.setAttribute("aria-label", "最大化");
  }
}

function setPreview(avatar, displayName, bio) {
  const avatarNode = q("p_preview_avatar");
  const nameNode = q("p_preview_name");
  const bioNode = q("p_preview_bio");

  if (nameNode) {
    nameNode.textContent = safeText(displayName) || pageState.username || "-";
  }
  if (bioNode) {
    bioNode.textContent = safeText(bio) || "暂未填写简介";
  }

  if (!avatarNode) return;

  avatarNode.textContent = firstChar(avatar) || "?";
}

function bindLivePreview() {
  const displayNameInput = q("p_display_name");
  const bioInput = q("p_bio");
  const avatarInput = q("p_avatar_text");

  const update = () => {
    const avatar = firstChar(avatarInput?.value);
    if (avatarInput && avatarInput.value !== avatar) {
      avatarInput.value = avatar;
    }
    const displayName = safeText(displayNameInput?.value);
    const bio = safeText(bioInput?.value);
    setPreview(avatar, displayName, bio);
  };

  [displayNameInput, bioInput, avatarInput].forEach((node) => {
    if (!node) return;
    node.addEventListener("input", update);
  });
}

async function loadProfile() {
  const response = await fetch(`${pageState.serverUrl}/api/profile`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${pageState.token}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `读取资料失败（${response.status}）`);
  }

  const payload = await response.json();
  const profile = payload?.profile || {};

  pageState.profile = {
    username: safeText(profile.username) || pageState.username,
    displayName: safeText(profile.displayName) || safeText(profile.username) || pageState.username,
    bio: safeText(profile.bio),
    avatar: firstChar(profile.avatar),
  };

  if (q("p_server_scope")) {
    q("p_server_scope").textContent = safeText(payload?.roomScope)
      ? `当前房间：${safeText(payload.roomScope)}`
      : "当前房间：-";
  }

  if (q("p_username")) q("p_username").value = pageState.profile.username;
  if (q("p_display_name")) q("p_display_name").value = pageState.profile.displayName;
  if (q("p_bio")) q("p_bio").value = pageState.profile.bio;
  if (q("p_avatar_text")) q("p_avatar_text").value = pageState.profile.avatar;

  setPreview(pageState.profile.avatar, pageState.profile.displayName, pageState.profile.bio);
}

async function saveProfile() {
  const saveBtn = q("p_save");
  if (saveBtn) saveBtn.disabled = true;

  try {
    const displayName = safeText(q("p_display_name")?.value).slice(0, 30) || pageState.username;
    const bio = safeText(q("p_bio")?.value).slice(0, 200);
    const avatar = firstChar(q("p_avatar_text")?.value);
    if (q("p_avatar_text")) q("p_avatar_text").value = avatar;

    setStateText("正在保存...");

    const response = await fetch(`${pageState.serverUrl}/api/profile/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pageState.token}`,
      },
      body: JSON.stringify({
        displayName,
        bio,
        avatar,
        avatarKind: "emoji",
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `保存失败（${response.status}）`);
    }

    const payload = await response.json();
    const profile = payload?.profile || {
      username: pageState.username,
      displayName,
      bio,
      avatar,
      avatarKind: "emoji",
    };

    window.api.emitProfileUpdated({ profile });
    setStateText("资料已保存");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function readQuery() {
  const params = new URLSearchParams(window.location.search);
  pageState.serverUrl = safeText(params.get("serverUrl")).replace(/\/+$/, "");
  pageState.token = safeText(params.get("token"));
  pageState.username = safeText(params.get("username"));
}

async function applySavedTheme() {
  document.body.dataset.theme = "dark";
  if (!window.api?.loadSettings) return;

  try {
    const settings = await window.api.loadSettings();
    document.body.dataset.theme = normalizeTheme(settings?.ui?.theme);
  } catch {
    document.body.dataset.theme = "dark";
  }
}

async function init() {
  document.body.dataset.platform = window.api?.platform || "unknown";
  await applySavedTheme();
  readQuery();

  if (!pageState.serverUrl || !pageState.token) {
    throw new Error("登录信息已失效，请回到主页面重新打开个人资料。");
  }

  bindLivePreview();

  if (q("p_btn_min")) {
    q("p_btn_min").addEventListener("click", () => {
      if (window.api?.minimizeWindow) {
        window.api.minimizeWindow();
        return;
      }
      window.close();
    });
  }

  if (q("p_btn_max")) {
    q("p_btn_max").addEventListener("click", async () => {
      if (window.api?.toggleMaximizeWindow) {
        await window.api.toggleMaximizeWindow();
        await syncWindowMaxButton();
      }
    });
  }

  if (q("p_close_window")) {
    q("p_close_window").addEventListener("click", () => {
      if (window.api?.closeWindow) {
        window.api.closeWindow();
        return;
      }
      window.close();
    });
  }

  if (q("p_cancel")) {
    q("p_cancel").addEventListener("click", () => {
      if (window.api?.closeWindow) {
        window.api.closeWindow();
        return;
      }
      window.close();
    });
  }

  if (q("p_save")) {
    q("p_save").addEventListener("click", () => {
      saveProfile().catch((err) => {
        setStateText(`保存失败：${err.message || err}`);
      });
    });
  }

  window.addEventListener("resize", () => {
    syncWindowMaxButton().catch(() => {});
  });

  await loadProfile();
  await syncWindowMaxButton();
  setStateText("资料已加载");
}

init().catch((err) => {
  setStateText(`页面打开失败：${err.message || err}`);
});
