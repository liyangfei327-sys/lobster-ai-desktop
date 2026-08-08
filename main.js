const fs = require("fs");
const path = require("path");

const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  shell,
  desktopCapturer
} = require("electron");

let win = null;
let patrolTimer = null;
let patrolStartTimer = null;
let savePositionTimer = null;
let resumePatrolTimer = null;
let dragState = null;

let isPatrolling = true;
let currentEdge = "top";

const WINDOW_WIDTH = 380;
const WINDOW_HEIGHT = 460;
const SPEED = 2;
const TICK_MS = 30;

// V24：本地记忆 + 固定人格
const MAX_MEMORY_MESSAGES = 16;

const PERSONALITY_PROMPT = `
你是 Lobster AI，一只住在用户电脑桌面上的 AI 小龙虾桌宠。

你的性格和回答方式：
- 默认使用中文回答，除非用户明确要求其他语言。
- 聪明、友好、稍微活泼，但不要过度卖萌。
- 回答尽量清楚、实用、简洁。
- 技术问题优先给具体步骤。
- 遇到报错先判断原因，再给最直接的解决办法。
- 可以自然承接最近聊天上下文。
- 不要假装记得本地记忆里没有出现过的事情。
`.trim();

function getMemoryFilePath() {
  return path.join(
    app.getPath("userData"),
    "lobster-memory.json"
  );
}

function loadConversationMemory() {
  const filePath = getMemoryFilePath();

  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const raw =
      fs.readFileSync(
        filePath,
        "utf8"
      );

    if (!raw || !raw.trim()) {
      return [];
    }

    const parsed =
      JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .filter((item) => {
        return (
          item &&
          (
            item.role === "user" ||
            item.role === "assistant"
          ) &&
          typeof item.content === "string"
        );
      })
      .slice(-MAX_MEMORY_MESSAGES);
  } catch (error) {
    console.error(
      "读取 Lobster 记忆失败：",
      error.message
    );

    return [];
  }
}

function saveConversationMemory(messages) {
  const safeMessages =
    messages
      .filter((item) => {
        return (
          item &&
          (
            item.role === "user" ||
            item.role === "assistant"
          ) &&
          typeof item.content === "string"
        );
      })
      .slice(-MAX_MEMORY_MESSAGES);

  try {
    fs.writeFileSync(
      getMemoryFilePath(),
      JSON.stringify(
        safeMessages,
        null,
        2
      ),
      "utf8"
    );
  } catch (error) {
    console.error(
      "保存 Lobster 记忆失败：",
      error
    );
  }
}

function clearConversationMemory() {
  const filePath = getMemoryFilePath();

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return true;
  } catch (error) {
    console.error(
      "清除 Lobster 记忆失败：",
      error
    );

    return false;
  }
}

// 位置记录文件路径
function getPositionFilePath() {
  return path.join(
    app.getPath("userData"),
    "window-position.json"
  );
}

// 保存当前位置
function saveWindowPosition() {
  if (!win || win.isDestroyed()) {
    return;
  }

  try {
    const bounds = win.getBounds();

    const position = {
      x: bounds.x,
      y: bounds.y
    };

    fs.writeFileSync(
      getPositionFilePath(),
      JSON.stringify(position, null, 2),
      "utf8"
    );
  } catch (error) {
    console.error("保存位置失败：", error);
  }
}

// 防止移动时频繁写文件
function scheduleSavePosition() {
  if (savePositionTimer) {
    clearTimeout(savePositionTimer);
  }

  savePositionTimer = setTimeout(() => {
    saveWindowPosition();
  }, 300);
}

// 读取上次位置
function loadWindowPosition() {
  try {
    const filePath = getPositionFilePath();

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(
      filePath,
      "utf8"
    );

    if (!content || !content.trim()) {
      fs.unlinkSync(filePath);
      return null;
    }

    const position = JSON.parse(content);

    if (
      Number.isFinite(position.x) &&
      Number.isFinite(position.y)
    ) {
      return position;
    }

    fs.unlinkSync(filePath);
  } catch (error) {
    console.error("位置文件损坏，已重置：", error.message);

    try {
      const filePath = getPositionFilePath();

      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // 删除失败时忽略
    }
  }

  return null;
}

// 确保窗口不会出现在屏幕外面
function keepPositionVisible(position) {
  const point = {
    x: position?.x ?? 0,
    y: position?.y ?? 0
  };

  const display =
    screen.getDisplayNearestPoint(point);

  const area = display.workArea;

  const minX = area.x;
  const minY = area.y;

  const maxX =
    area.x + area.width - WINDOW_WIDTH;

  const maxY =
    area.y + area.height - WINDOW_HEIGHT;

  return {
    x: Math.max(
      minX,
      Math.min(point.x, maxX)
    ),

    y: Math.max(
      minY,
      Math.min(point.y, maxY)
    )
  };
}

// 判断当前位置距离哪条边最近
function findNearestEdge(x, y) {
  const display =
    screen.getDisplayNearestPoint({ x, y });

  const area = display.workArea;

  const left = area.x;
  const top = area.y;

  const right =
    area.x + area.width - WINDOW_WIDTH;

  const bottom =
    area.y + area.height - WINDOW_HEIGHT;

  const distances = {
    top: Math.abs(y - top),
    right: Math.abs(x - right),
    bottom: Math.abs(y - bottom),
    left: Math.abs(x - left)
  };

  return Object.keys(distances).reduce(
    (nearest, edge) => {
      return distances[edge] <
        distances[nearest]
        ? edge
        : nearest;
    },
    "top"
  );
}

// 把窗口吸附到最近的边框
function snapToNearestEdge() {
  if (!win || win.isDestroyed()) {
    return;
  }

  let [x, y] = win.getPosition();

  const display =
    screen.getDisplayNearestPoint({ x, y });

  const area = display.workArea;

  const left = area.x;
  const top = area.y;

  const right =
    area.x + area.width - WINDOW_WIDTH;

  const bottom =
    area.y + area.height - WINDOW_HEIGHT;

  currentEdge = findNearestEdge(x, y);

  if (currentEdge === "top") {
    y = top;
  } else if (currentEdge === "right") {
    x = right;
  } else if (currentEdge === "bottom") {
    y = bottom;
  } else if (currentEdge === "left") {
    x = left;
  }

  win.setPosition(
    Math.round(x),
    Math.round(y)
  );

  sendEdge(currentEdge);
}

function sendEdge(edge) {
  if (!win || win.isDestroyed()) {
    return;
  }

  win.webContents.send(
    "lobster:edge",
    edge
  );
}

// 开始沿四条边巡逻
function startBorderPatrol() {
  if (!win || win.isDestroyed()) {
    return;
  }

  if (patrolTimer) {
    clearInterval(patrolTimer);
  }

  snapToNearestEdge();

  patrolTimer = setInterval(() => {
    if (
      !win ||
      win.isDestroyed() ||
      !isPatrolling
    ) {
      return;
    }

    let [x, y] = win.getPosition();

    const display =
      screen.getDisplayNearestPoint({ x, y });

    const area = display.workArea;

    const left = area.x;
    const top = area.y;

    const right =
      area.x + area.width - WINDOW_WIDTH;

    const bottom =
      area.y + area.height - WINDOW_HEIGHT;

    switch (currentEdge) {
      case "top":
        x += SPEED;

        if (x >= right) {
          x = right;
          currentEdge = "right";
          sendEdge(currentEdge);
        }
        break;

      case "right":
        y += SPEED;

        if (y >= bottom) {
          y = bottom;
          currentEdge = "bottom";
          sendEdge(currentEdge);
        }
        break;

      case "bottom":
        x -= SPEED;

        if (x <= left) {
          x = left;
          currentEdge = "left";
          sendEdge(currentEdge);
        }
        break;

      case "left":
        y -= SPEED;

        if (y <= top) {
          y = top;
          currentEdge = "top";
          sendEdge(currentEdge);
        }
        break;
    }

    win.setPosition(
      Math.round(x),
      Math.round(y)
    );
  }, TICK_MS);
}

// 截图
async function captureScreen() {
  try {
    const primaryDisplay =
      screen.getPrimaryDisplay();

    const size = primaryDisplay.size;

    const sources =
      await desktopCapturer.getSources({
        types: ["screen"],

        thumbnailSize: {
          width: size.width,
          height: size.height
        }
      });

    if (!sources.length) {
      throw new Error(
        "没有找到可截图的屏幕"
      );
    }

    const screenshot =
      sources[0].thumbnail.toPNG();

    const time = new Date()
      .toISOString()
      .replace(/[:.]/g, "-");

    const filePath = path.join(
      app.getPath("pictures"),
      `Lobster-Screenshot-${time}.png`
    );

    fs.writeFileSync(
      filePath,
      screenshot
    );

    shell.showItemInFolder(filePath);
  } catch (error) {
    console.error("截图失败：", error);
  }
}

function createWindow() {
  const savedPosition =
    loadWindowPosition();

  const safePosition =
    savedPosition
      ? keepPositionVisible(savedPosition)
      : keepPositionVisible({
          x: 80,
          y: 80
        });

  win = new BrowserWindow({
    x: safePosition.x,
    y: safePosition.y,

    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,

    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: "#00000000",
    show: false,

    webPreferences: {
      preload: path.join(
        __dirname,
        "preload.js"
      ),

      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile("index.html");

  // 窗口位置发生变化时记录
  win.on("move", () => {
    scheduleSavePosition();
  });

  // 关闭前立刻保存
  win.on("close", () => {
    saveWindowPosition();
  });

  win.once("ready-to-show", () => {
    win.show();

    // 先显示在上次位置
    // 两秒后再恢复巡逻
    patrolStartTimer = setTimeout(() => {
      startBorderPatrol();
    }, 2000);
  });
}


// V13：手动拖拽窗口
ipcMain.on(
  "lobster:drag-start",
  (_event, pointer) => {
    if (
      !win ||
      win.isDestroyed() ||
      !Number.isFinite(pointer?.screenX) ||
      !Number.isFinite(pointer?.screenY)
    ) {
      return;
    }

    if (resumePatrolTimer) {
      clearTimeout(resumePatrolTimer);
      resumePatrolTimer = null;
    }

    isPatrolling = false;

    const [windowX, windowY] =
      win.getPosition();

    dragState = {
      offsetX: pointer.screenX - windowX,
      offsetY: pointer.screenY - windowY
    };
  }
);

ipcMain.on(
  "lobster:drag-move",
  (_event, pointer) => {
    if (
      !dragState ||
      !win ||
      win.isDestroyed() ||
      !Number.isFinite(pointer?.screenX) ||
      !Number.isFinite(pointer?.screenY)
    ) {
      return;
    }

    const nextPosition = keepPositionVisible({
      x: pointer.screenX - dragState.offsetX,
      y: pointer.screenY - dragState.offsetY
    });

    win.setPosition(
      Math.round(nextPosition.x),
      Math.round(nextPosition.y)
    );
  }
);

ipcMain.handle(
  "lobster:drag-end",
  (_event, shouldResumePatrol) => {
    if (!win || win.isDestroyed()) {
      dragState = null;
      return false;
    }

    dragState = null;
    snapToNearestEdge();
    saveWindowPosition();

    if (resumePatrolTimer) {
      clearTimeout(resumePatrolTimer);
    }

    if (shouldResumePatrol) {
      resumePatrolTimer = setTimeout(() => {
        isPatrolling = true;
      }, 1000);
    }

    return true;
  }
);


async function moveWindowToNearestCorner(durationMs = 900) {
  if (!win || win.isDestroyed()) {
    return false;
  }

  isPatrolling = false;

  const [startX, startY] =
    win.getPosition();

  const display =
    screen.getDisplayNearestPoint({
      x: startX,
      y: startY
    });

  const area = display.workArea;

  const left = area.x;
  const top = area.y;

  const right =
    area.x + area.width - WINDOW_WIDTH;

  const bottom =
    area.y + area.height - WINDOW_HEIGHT;

  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom }
  ];

  const target = corners.reduce(
    (best, corner) => {
      const bestDistance = Math.hypot(
        best.x - startX,
        best.y - startY
      );

      const cornerDistance = Math.hypot(
        corner.x - startX,
        corner.y - startY
      );

      return cornerDistance < bestDistance
        ? corner
        : best;
    },
    corners[0]
  );

  const startTime = Date.now();

  return await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (!win || win.isDestroyed()) {
        clearInterval(timer);
        resolve(false);
        return;
      }

      const elapsed =
        Date.now() - startTime;

      const progress =
        Math.min(
          1,
          elapsed / durationMs
        );

      const eased =
        1 - Math.pow(1 - progress, 3);

      const nextX =
        startX +
        (target.x - startX) * eased;

      const nextY =
        startY +
        (target.y - startY) * eased;

      win.setPosition(
        Math.round(nextX),
        Math.round(nextY)
      );

      if (progress >= 1) {
        clearInterval(timer);

        currentEdge =
          findNearestEdge(
            target.x,
            target.y
          );

        sendEdge(currentEdge);
        saveWindowPosition();
        resolve(true);
      }
    }, 16);
  });
}

// 自定义菜单功能
ipcMain.handle(
  "lobster:menu-action",
  async (_event, action) => {
    if (action === "screenshot") {
      await captureScreen();
      return true;
    }

    if (action === "telegram") {
      try {
        await shell.openExternal("tg://");
      } catch {
        await shell.openExternal(
          "https://web.telegram.org/"
        );
      }

      return true;
    }

    if (action === "clear-memory") {
      return clearConversationMemory();
    }

    if (action === "quit") {
      saveWindowPosition();
      app.quit();
      return true;
    }

    return false;
  }
);


ipcMain.handle(
  "lobster:move-to-nearest-corner",
  async () => {
    return await moveWindowToNearestCorner(
      900
    );
  }
);

// 暂停或继续巡逻
ipcMain.handle(
  "lobster:set-patrolling",
  (_event, shouldPatrol) => {
    isPatrolling =
      Boolean(shouldPatrol);

    // 聊天结束并恢复巡逻时，
    // 从当前位置吸附到最近边框
    if (isPatrolling) {
      snapToNearestEdge();
    }

    return isPatrolling;
  }
);

// OpenClaw 聊天
ipcMain.handle(
  "openclaw:chat",
  async (_event, userMessage) => {
    const password =
      process.env
        .OPENCLAW_GATEWAY_PASSWORD;

    if (!password) {
      throw new Error(
        "没有设置 OpenClaw Gateway 密码"
      );
    }

    const response = await fetch(
      "http://127.0.0.1:18789/v1/chat/completions",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          Authorization:
            `Bearer ${password}`
        },

        body: JSON.stringify({
          model: "openclaw/default",
          user: "lobster-ai-desktop",

          messages: [
            {
              role: "system",
              content: PERSONALITY_PROMPT
            },
            ...loadConversationMemory(),
            {
              role: "user",
              content: userMessage
            }
          ]
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        `OpenClaw 请求失败，状态码：${response.status}`
      );
    }

    const reply =
      data?.choices?.[0]
        ?.message?.content ||
      "OpenClaw 没有返回文字";

    const memory =
      loadConversationMemory();

    memory.push(
      {
        role: "user",
        content: userMessage
      },
      {
        role: "assistant",
        content: reply
      }
    );

    saveConversationMemory(memory);

    return reply;
  }
);

app.whenReady().then(createWindow);

app.on("before-quit", () => {
  saveWindowPosition();
});

app.on("window-all-closed", () => {
  if (patrolTimer) {
    clearInterval(patrolTimer);
  }

  if (patrolStartTimer) {
    clearTimeout(patrolStartTimer);
  }

  if (savePositionTimer) {
    clearTimeout(savePositionTimer);
  }

  if (resumePatrolTimer) {
    clearTimeout(resumePatrolTimer);
  }

  app.quit();
});