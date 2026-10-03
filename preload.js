const {
  contextBridge,
  ipcRenderer
} = require("electron");

contextBridge.exposeInMainWorld("lobsterAI", {
  chat(message) {
    return ipcRenderer.invoke(
      "openclaw:chat",
      message
    );
  },

  setPatrolling(shouldPatrol) {
    return ipcRenderer.invoke(
      "lobster:set-patrolling",
      shouldPatrol
    );
  },

  runMenuAction(action) {
    return ipcRenderer.invoke(
      "lobster:menu-action",
      action
    );
  },

  beginDrag(screenX, screenY) {
    ipcRenderer.send(
      "lobster:drag-start",
      { screenX, screenY }
    );
  },

  moveDrag(screenX, screenY) {
    ipcRenderer.send(
      "lobster:drag-move",
      { screenX, screenY }
    );
  },

  endDrag(shouldResumePatrol) {
    return ipcRenderer.invoke(
      "lobster:drag-end",
      shouldResumePatrol
    );
  },

  moveToNearestCorner() {
    return ipcRenderer.invoke(
      "lobster:move-to-nearest-corner"
    );
  },

  showContextMenu() {
    ipcRenderer.send(
      "lobster:show-menu"
    );
  },

  onEdgeChange(callback) {
    ipcRenderer.on(
      "lobster:edge",
      (_event, edge) => {
        callback(edge);
      }
    );
  },

  onAction(callback) {
    ipcRenderer.on(
      "lobster:action",
      (_event, action) => {
        callback(action);
      }
    );
  }
});