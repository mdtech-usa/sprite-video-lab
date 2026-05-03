const state = {
  upload: null,
  job: null,
  exportResult: null,
  processPreview: null,
  selected: new Set(),
  segment: { start: 0, end: 0, startFrame: 1, endFrame: 1, confirmed: false },
  preview: {
    rafId: null,
    currentIndex: 0,
    isPlaying: true,
    renderToken: 0,
    warmupToken: 0,
    imageCache: new Map(),
    background: "#F6FBF6",
  },
  processPreviewZoom: {
    source: 100,
    processed: 100,
  },
};

const els = {};
const STORAGE_KEY = "sprite-video-lab-session-v2";
const SUPPORTED_VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv", ".webm"];
const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp", ".bmp"];
const SUPPORTED_UPLOAD_EXTENSIONS = [...SUPPORTED_VIDEO_EXTENSIONS, ...SUPPORTED_IMAGE_EXTENSIONS];
const AI_RESOLUTION_MIN = 256;
const AI_RESOLUTION_MAX = 2560;
const AI_RESOLUTION_STEP = 32;
const AI_RESOLUTION_DEFAULT = 1024;
let hotReloadVersion = null;
let hotReloadTimerId = null;
let uploadDragDepth = 0;

document.addEventListener("DOMContentLoaded", () => {
  bindElements();
  bindEvents();
  updatePreviewBackground(state.preview.background, false);
  syncManualColorLabel();
  updateChromaVisibility();
  normalizePreviewInterval();
  updatePreviewControls(0);
  drawPreviewPlaceholder();
  resetProcessPreview();
  updateSegmentConfirmationUI();
  setStatus("\u7B49\u5F85\u5BFC\u5165\u7D20\u6750\u3002");
  restoreSessionFromStorage();
  normalizeAiResolutionInput(false);
  startHotReloadPolling();
  window.addEventListener("beforeunload", persistSession);
});

function bindElements() {
  [
    "pathInput",
    "importPathButton",
    "uploadDropzone",
    "uploadInput",
    "videoName",
    "videoSize",
    "videoFps",
    "videoDuration",
    "previewPanel",
    "processPanel",
    "resultPanel",
    "videoPreview",
    "mediaPreviewImage",
    "videoProgress",
    "videoProgressFill",
    "videoToolbar",
    "currentTimeLabel",
    "startRange",
    "startInput",
    "startStepUpButton",
    "startStepDownButton",
    "endRange",
    "endInput",
    "endStepUpButton",
    "endStepDownButton",
    "segmentLength",
    "segmentConfirmStatus",
    "segmentConfirmHint",
    "keepEveryInput",
    "targetSizeInput",
    "canvasModeInput",
    "reducePxInput",
    "chromaEnabledInput",
    "matteModeInput",
    "keyModeInput",
    "manualColorField",
    "manualKeyInput",
    "manualKeyLabel",
    "thresholdInput",
    "softnessInput",
    "despillInput",
    "haloInput",
    "corridorEnabledInput",
    "corridorScreenInput",
    "aiModelInput",
    "aiDeviceInput",
    "aiResolutionInput",
    "lumaBlackInput",
    "lumaWhiteInput",
    "lumaGammaInput",
    "lumaStrengthInput",
    "previewFrameButton",
    "processPreviewTimeLabel",
    "processPreviewKeyLabel",
    "previewSourceImage",
    "previewSourceEmpty",
    "previewSourceZoomInput",
    "previewSourceZoomLabel",
    "previewSourceZoomOutButton",
    "previewSourceZoomResetButton",
    "previewSourceZoomInButton",
    "previewProcessedImage",
    "previewProcessedEmpty",
    "previewProcessedZoomInput",
    "previewProcessedZoomLabel",
    "previewProcessedZoomOutButton",
    "previewProcessedZoomResetButton",
    "previewProcessedZoomInButton",
    "processStepShell",
    "processLockNote",
    "processButton",
    "jobSummary",
    "selectionCount",
    "openProcessedButton",
    "animationPreviewCanvas",
    "previewEmptyState",
    "previewFrameLabel",
    "previewSelectedCount",
    "previewProgressBar",
    "previewProgressFill",
    "previewProgressLabel",
    "previewPlayPauseButton",
    "previewRestartButton",
    "previewBackgroundInput",
    "previewBackgroundLabel",
    "previewIntervalInput",
    "frameGrid",
    "selectAllButton",
    "selectNoneButton",
    "selectOddButton",
    "selectEvenButton",
    "invertSelectionButton",
    "sheetColumnsInput",
    "exportButton",
    "exportResult",
    "appStatus",
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.importPathButton.addEventListener("click", importFromPath);
  els.uploadInput.addEventListener("change", handleUploadInputChange);
  els.previewFrameButton.addEventListener("click", previewCurrentFrame);
  els.processButton.addEventListener("click", processVideo);
  els.exportButton.addEventListener("click", exportFrames);
  bindUploadDropzone();

  bindTimePair("start", els.startRange, els.startInput, els.startStepDownButton, els.startStepUpButton);
  bindTimePair("end", els.endRange, els.endInput, els.endStepDownButton, els.endStepUpButton);

  els.videoPreview.addEventListener("loadedmetadata", () => {
    if (!isVideoUpload()) {
      return;
    }
    muteVideoPreview();
    updateVideoProgress(state.segment.start || 0);
    restartSegmentPlayback({ autoplay: false });
  });

  els.videoPreview.addEventListener("timeupdate", () => {
    if (!isVideoUpload()) {
      return;
    }
    const current = els.videoPreview.currentTime || 0;
    els.currentTimeLabel.textContent = `\u5f53\u524d ${formatSeconds(current)}`;
    updateVideoProgress(current);
    if (
      state.upload &&
      state.segment.end > state.segment.start &&
      current >= Math.max(state.segment.end - 0.01, state.segment.start)
    ) {
      restartSegmentPlayback({ autoplay: true });
    }
  });

  els.manualKeyInput.addEventListener("input", syncManualColorLabel);
  els.matteModeInput.addEventListener("change", updateChromaVisibility);
  els.keyModeInput.addEventListener("change", updateChromaVisibility);
  els.chromaEnabledInput.addEventListener("change", updateChromaVisibility);
  els.corridorEnabledInput.addEventListener("change", updateChromaVisibility);
  els.aiResolutionInput.addEventListener("change", normalizeAiResolutionInput);

  els.frameGrid.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "checkbox") {
      return;
    }
    const index = Number(target.dataset.index);
    if (Number.isNaN(index)) {
      return;
    }
    if (target.checked) {
      state.selected.add(index);
    } else {
      state.selected.delete(index);
    }
    refreshCardSelection(index, target.checked);
    renderSelectionCount();
    syncAnimationPreview();
    persistSession();
  });

  els.selectAllButton.addEventListener("click", () => selectFrames(() => true));
  els.selectNoneButton.addEventListener("click", () => {
    state.selected = new Set();
    state.preview.currentIndex = 0;
    renderFrames();
  });
  els.selectOddButton.addEventListener("click", () => selectFrames((frame) => (frame.index + 1) % 2 === 1));
  els.selectEvenButton.addEventListener("click", () => selectFrames((frame) => (frame.index + 1) % 2 === 0));
  els.invertSelectionButton.addEventListener("click", () => {
    if (!state.job) return;
    const next = new Set();
    state.job.frames.forEach((frame) => {
      if (!state.selected.has(frame.index)) {
        next.add(frame.index);
      }
    });
    state.selected = next;
    state.preview.currentIndex = 0;
    renderFrames();
  });

  els.openProcessedButton.addEventListener("click", async () => {
    if (state.job?.processed_dir) {
      await openPath(state.job.processed_dir);
    }
  });

  els.previewPlayPauseButton.addEventListener("click", togglePreviewPlayback);
  els.previewRestartButton.addEventListener("click", restartPreviewPlayback);
  els.previewBackgroundInput.addEventListener("input", () => {
    updatePreviewBackground(els.previewBackgroundInput.value, true);
    syncAnimationPreview(false);
  });
  els.previewIntervalInput.addEventListener("change", () => {
    normalizePreviewInterval();
    restartPreviewTimer();
    persistSession();
  });
  bindProcessPreviewZoom("source");
  bindProcessPreviewZoom("processed");

  [
    els.keepEveryInput,
    els.targetSizeInput,
    els.canvasModeInput,
    els.reducePxInput,
    els.chromaEnabledInput,
    els.keyModeInput,
    els.manualKeyInput,
    els.thresholdInput,
    els.softnessInput,
    els.despillInput,
    els.haloInput,
    els.corridorEnabledInput,
    els.corridorScreenInput,
    els.matteModeInput,
    els.aiModelInput,
    els.aiDeviceInput,
    els.aiResolutionInput,
    els.lumaBlackInput,
    els.lumaWhiteInput,
    els.lumaGammaInput,
    els.lumaStrengthInput,
    els.startInput,
    els.endInput,
  ].forEach((element) => {
    const eventName = element instanceof HTMLInputElement && element.type === "checkbox" ? "change" : "input";
    element.addEventListener(eventName, persistSession);
  });
}

function bindTimePair(key, rangeEl, numberEl, decreaseButton, increaseButton) {
  const frameKey = key === "start" ? "startFrame" : "endFrame";
  const applySegmentFrame = (nextFrame) => {
    state.segment[frameKey] = clampSegmentFrame(nextFrame);
    normalizeSegment(key);
    renderSegmentControls();
    updateSegmentConfirmationUI();
    restartSegmentPlayback({ autoplay: true });
    persistSession();
  };

  const handler = (event) => {
    const nextValue = Number(event.target.value);
    if (Number.isNaN(nextValue)) {
      return;
    }
    applySegmentFrame(nextValue);
  };

  rangeEl.addEventListener("input", handler);
  numberEl.addEventListener("input", handler);
  numberEl.addEventListener("change", handler);
  decreaseButton.addEventListener("click", () => {
    applySegmentFrame(state.segment[frameKey] - 1);
  });
  increaseButton.addEventListener("click", () => {
    applySegmentFrame(state.segment[frameKey] + 1);
  });
  numberEl.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
      return;
    }
    event.preventDefault();
    const direction = event.key === "ArrowUp" ? 1 : -1;
    applySegmentFrame(state.segment[frameKey] + direction);
  });
}

function bindProcessPreviewZoom(kind) {
  const input = kind === "source" ? els.previewSourceZoomInput : els.previewProcessedZoomInput;
  const decreaseButton = kind === "source" ? els.previewSourceZoomOutButton : els.previewProcessedZoomOutButton;
  const resetButton = kind === "source" ? els.previewSourceZoomResetButton : els.previewProcessedZoomResetButton;
  const increaseButton = kind === "source" ? els.previewSourceZoomInButton : els.previewProcessedZoomInButton;

  input.addEventListener("input", () => {
    updateProcessPreviewZoom(kind, Number(input.value || 100), true);
  });
  decreaseButton.addEventListener("click", () => {
    updateProcessPreviewZoom(kind, state.processPreviewZoom[kind] - 10, true);
  });
  resetButton.addEventListener("click", () => {
    updateProcessPreviewZoom(kind, 100, true);
  });
  increaseButton.addEventListener("click", () => {
    updateProcessPreviewZoom(kind, state.processPreviewZoom[kind] + 10, true);
  });
}

function updateProcessPreviewZoom(kind, value, shouldPersist = false) {
  const normalized = clamp(Math.round(value / 10) * 10, 50, 800);
  state.processPreviewZoom[kind] = normalized;

  const input = kind === "source" ? els.previewSourceZoomInput : els.previewProcessedZoomInput;
  const label = kind === "source" ? els.previewSourceZoomLabel : els.previewProcessedZoomLabel;
  const image = kind === "source" ? els.previewSourceImage : els.previewProcessedImage;

  input.value = String(normalized);
  label.textContent = `${normalized}%`;
  image.style.transform = `scale(${normalized / 100})`;

  if (shouldPersist) {
    persistSession();
  }
}

function currentMatteMode() {
  if (!els.chromaEnabledInput.checked) {
    return "none";
  }
  return els.matteModeInput.value || "chroma";
}

function currentUsesCorridorKey() {
  return currentMatteMode() !== "none" && els.corridorEnabledInput.checked;
}

function normalizeAiResolution(value) {
  const numeric = Number(value);
  const raw = Number.isFinite(numeric) ? numeric : AI_RESOLUTION_DEFAULT;
  const clamped = clamp(Math.round(raw), AI_RESOLUTION_MIN, AI_RESOLUTION_MAX);
  const aligned = Math.floor((clamped + AI_RESOLUTION_STEP / 2) / AI_RESOLUTION_STEP) * AI_RESOLUTION_STEP;
  return clamp(aligned, AI_RESOLUTION_MIN, AI_RESOLUTION_MAX);
}

function normalizeAiResolutionInput(shouldPersist = true) {
  const normalized = normalizeAiResolution(els.aiResolutionInput.value);
  if (els.aiResolutionInput.value !== String(normalized)) {
    els.aiResolutionInput.value = String(normalized);
  }
  if (shouldPersist) {
    persistSession();
  }
}

function collectFormState() {
  return {
    keep_every: Number(els.keepEveryInput.value || 1),
    target_size: Number(els.targetSizeInput.value || 128),
    canvas_mode: els.canvasModeInput.value,
    reduce_px: Number(els.reducePxInput.value || 0),
    chroma_enabled: els.chromaEnabledInput.checked,
    matte_mode: currentMatteMode(),
    key_mode: els.keyModeInput.value,
    manual_key_hex: els.manualKeyInput.value,
    threshold: Number(els.thresholdInput.value || 0),
    softness: Number(els.softnessInput.value === "" ? 1 : els.softnessInput.value),
    despill_strength: Number(els.despillInput.value || 0),
    halo_pixels: Number(els.haloInput.value || 0),
    corridorkey_enabled: els.corridorEnabledInput.checked,
    corridorkey_screen: els.corridorScreenInput.value,
    ai_model: els.aiModelInput.value,
    ai_device: els.aiDeviceInput.value,
    ai_resolution: normalizeAiResolution(els.aiResolutionInput.value),
    luma_black: Number(els.lumaBlackInput.value || 24),
    luma_white: Number(els.lumaWhiteInput.value || 230),
    luma_gamma: Number(els.lumaGammaInput.value || 1),
    luma_strength: Number(els.lumaStrengthInput.value || 1),
    preview_background: state.preview.background,
    preview_interval: clamp(Number(els.previewIntervalInput.value || 100), 20, 5000),
    process_preview_zoom: {
      source: state.processPreviewZoom.source,
      processed: state.processPreviewZoom.processed,
    },
    segment: {
      start: Number(state.segment.start || 0),
      end: Number(state.segment.end || 0),
      confirmed: Boolean(state.segment.confirmed),
    },
  };
}

function collectProcessingPayload() {
  return {
    upload_id: state.upload?.upload_id || "",
    start_time: state.segment.start,
    end_time: state.segment.end,
    keep_every: Number(els.keepEveryInput.value || 1),
    target_size: Number(els.targetSizeInput.value || 128),
    canvas_mode: els.canvasModeInput.value,
    reduce_px: Number(els.reducePxInput.value || 0),
    chroma_enabled: els.chromaEnabledInput.checked,
    matte_mode: currentMatteMode(),
    key_mode: els.keyModeInput.value,
    manual_key_hex: els.manualKeyInput.value,
    threshold: Number(els.thresholdInput.value || 0),
    softness: Number(els.softnessInput.value === "" ? 1 : els.softnessInput.value),
    despill_strength: Number(els.despillInput.value || 0),
    halo_pixels: Number(els.haloInput.value || 0),
    corridorkey_enabled: els.corridorEnabledInput.checked,
    corridorkey_screen: els.corridorScreenInput.value,
    ai_model: els.aiModelInput.value,
    ai_device: els.aiDeviceInput.value,
    ai_resolution: normalizeAiResolution(els.aiResolutionInput.value),
    luma_black: Number(els.lumaBlackInput.value || 24),
    luma_white: Number(els.lumaWhiteInput.value || 230),
    luma_gamma: Number(els.lumaGammaInput.value || 1),
    luma_strength: Number(els.lumaStrengthInput.value || 1),
  };
}

function applyFormState(snapshot) {
  if (!snapshot) {
    return;
  }

  if (snapshot.keep_every != null) els.keepEveryInput.value = String(snapshot.keep_every);
  if (snapshot.target_size != null) els.targetSizeInput.value = String(snapshot.target_size);
  if (snapshot.canvas_mode && [...els.canvasModeInput.options].some((option) => option.value === snapshot.canvas_mode)) {
    els.canvasModeInput.value = snapshot.canvas_mode;
  }
  if (snapshot.reduce_px != null) els.reducePxInput.value = String(snapshot.reduce_px);
  if (snapshot.chroma_enabled != null) els.chromaEnabledInput.checked = Boolean(snapshot.chroma_enabled);
  if (snapshot.matte_mode && [...els.matteModeInput.options].some((option) => option.value === snapshot.matte_mode)) {
    els.matteModeInput.value = snapshot.matte_mode;
  }
  if (snapshot.key_mode) els.keyModeInput.value = snapshot.key_mode;
  if (snapshot.manual_key_hex) els.manualKeyInput.value = snapshot.manual_key_hex;
  if (snapshot.threshold != null) els.thresholdInput.value = String(snapshot.threshold);
  if (snapshot.softness != null) els.softnessInput.value = String(snapshot.softness);
  if (snapshot.despill_strength != null) els.despillInput.value = String(snapshot.despill_strength);
  if (snapshot.halo_pixels != null) els.haloInput.value = String(snapshot.halo_pixels);
  if (snapshot.corridorkey_enabled != null) els.corridorEnabledInput.checked = Boolean(snapshot.corridorkey_enabled);
  if (
    snapshot.corridorkey_screen &&
    [...els.corridorScreenInput.options].some((option) => option.value === snapshot.corridorkey_screen)
  ) {
    els.corridorScreenInput.value = snapshot.corridorkey_screen;
  }
  if (snapshot.ai_model && [...els.aiModelInput.options].some((option) => option.value === snapshot.ai_model)) {
    els.aiModelInput.value = snapshot.ai_model;
  }
  if (snapshot.ai_device && [...els.aiDeviceInput.options].some((option) => option.value === snapshot.ai_device)) {
    els.aiDeviceInput.value = snapshot.ai_device;
  }
  if (snapshot.ai_resolution != null) els.aiResolutionInput.value = String(normalizeAiResolution(snapshot.ai_resolution));
  if (snapshot.luma_black != null) els.lumaBlackInput.value = String(snapshot.luma_black);
  if (snapshot.luma_white != null) els.lumaWhiteInput.value = String(snapshot.luma_white);
  if (snapshot.luma_gamma != null) els.lumaGammaInput.value = String(snapshot.luma_gamma);
  if (snapshot.luma_strength != null) els.lumaStrengthInput.value = String(snapshot.luma_strength);
  updatePreviewBackground(snapshot.preview_background || state.preview.background, false);
  if (snapshot.preview_interval != null) els.previewIntervalInput.value = String(snapshot.preview_interval);
  if (snapshot.process_preview_zoom) {
    updateProcessPreviewZoom("source", Number(snapshot.process_preview_zoom.source || 100), false);
    updateProcessPreviewZoom("processed", Number(snapshot.process_preview_zoom.processed || 100), false);
  } else {
    updateProcessPreviewZoom("source", 100, false);
    updateProcessPreviewZoom("processed", 100, false);
  }

  if (snapshot.segment) {
    state.segment.start = Number(snapshot.segment.start || 0);
    state.segment.end = Number(snapshot.segment.end || 0);
    syncSegmentFramesFromTimes();
    state.segment.confirmed = Boolean(snapshot.segment.confirmed);
  }

  syncManualColorLabel();
  updateChromaVisibility();
  normalizePreviewInterval();
}

function persistSession() {
  try {
    const snapshot = {
      upload: state.upload,
      job: state.job,
      exportResult: state.exportResult,
      processPreview: state.processPreview,
      selectedIndices: Array.from(state.selected).sort((a, b) => a - b),
      preview: {
        isPlaying: state.preview.isPlaying,
        currentIndex: state.preview.currentIndex,
      },
      form: collectFormState(),
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn("persistSession failed", error);
  }
}

function restoreSessionFromStorage() {
  let snapshot = null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    snapshot = JSON.parse(raw);
  } catch (error) {
    console.warn("restoreSessionFromStorage failed", error);
    return;
  }

  if (!snapshot || !snapshot.upload) {
    if (snapshot?.form) {
      applyFormState(snapshot.form);
      updateSegmentConfirmationUI();
    }
    return;
  }

  applyUpload(snapshot.upload);
  applyFormState(snapshot.form);
  if (state.upload) {
    normalizeSegment("end");
    renderSegmentControls();
    updateSegmentConfirmationUI();
    restartSegmentPlayback({ autoplay: false });
  }

  if (snapshot.preview && typeof snapshot.preview.isPlaying === "boolean") {
    state.preview.isPlaying = snapshot.preview.isPlaying;
  }

  if (snapshot.processPreview) {
    state.processPreview = snapshot.processPreview;
    renderProcessPreview();
  }

  if (snapshot.job?.frames) {
    state.job = snapshot.job;
    state.exportResult = snapshot.exportResult || null;
    if (Array.isArray(snapshot.selectedIndices)) {
      state.selected = new Set(snapshot.selectedIndices);
    } else {
      state.selected = new Set(snapshot.job.frames.map((frame) => frame.index));
    }
    state.preview.currentIndex = clamp(
      Number(snapshot.preview?.currentIndex || 0),
      0,
      Math.max(snapshot.job.frames.length - 1, 0)
    );
    renderJob();
    if (state.exportResult) {
      renderExportResult();
    }
  } else {
    syncAnimationPreview();
  }

  setStatus("\u5DF2\u6062\u590D\u4E0A\u6B21\u7684\u5DE5\u4F5C\u73B0\u573A\u3002", "success");
}

function startHotReloadPolling() {
  if (hotReloadTimerId !== null) {
    window.clearTimeout(hotReloadTimerId);
    hotReloadTimerId = null;
  }

  const poll = async () => {
    try {
      const data = await apiJson(`/api/app-version?ts=${Date.now()}`);
      const nextVersion = String(data.version || "0");
      const pollMs = Number(data.poll_ms || 1200);
      if (hotReloadVersion === null) {
        hotReloadVersion = nextVersion;
      } else if (nextVersion !== hotReloadVersion) {
        hotReloadVersion = nextVersion;
        persistSession();
        setStatus("\u68C0\u6D4B\u5230\u4EE3\u7801\u53D8\u66F4\uFF0C\u6B63\u5728\u81EA\u52A8\u5237\u65B0...", "success");
        window.setTimeout(() => window.location.reload(), 900);
        return;
      }
      hotReloadTimerId = window.setTimeout(poll, pollMs);
    } catch (error) {
      hotReloadTimerId = window.setTimeout(poll, 1200);
    }
  };

  poll();
}

function bindUploadDropzone() {
  els.uploadDropzone.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    event.preventDefault();
    if (els.uploadInput.disabled) {
      return;
    }
    els.uploadInput.click();
  });

  els.uploadDropzone.addEventListener("dragenter", (event) => {
    if (!dragEventHasFiles(event)) {
      return;
    }
    event.preventDefault();
    uploadDragDepth += 1;
    els.uploadDropzone.classList.add("dragging");
  });

  els.uploadDropzone.addEventListener("dragover", (event) => {
    if (!dragEventHasFiles(event)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
    els.uploadDropzone.classList.add("dragging");
  });

  els.uploadDropzone.addEventListener("dragleave", (event) => {
    if (!dragEventHasFiles(event)) {
      return;
    }
    event.preventDefault();
    uploadDragDepth = Math.max(0, uploadDragDepth - 1);
    if (uploadDragDepth === 0) {
      els.uploadDropzone.classList.remove("dragging");
    }
  });

  els.uploadDropzone.addEventListener("drop", async (event) => {
    if (!dragEventHasFiles(event)) {
      return;
    }
    event.preventDefault();
    uploadDragDepth = 0;
    els.uploadDropzone.classList.remove("dragging");
    const [file] = event.dataTransfer?.files || [];
    await uploadSelectedFile(file);
  });
}

function dragEventHasFiles(event) {
  const types = Array.from(event.dataTransfer?.types || []);
  return types.includes("Files");
}

function setUploadDropzoneBusy(isBusy) {
  els.uploadDropzone.classList.toggle("busy", isBusy);
  els.uploadDropzone.setAttribute("aria-busy", isBusy ? "true" : "false");
  els.uploadDropzone.setAttribute("aria-disabled", isBusy ? "true" : "false");
  els.uploadInput.disabled = isBusy;
}

function currentUploadInfo(upload = state.upload) {
  return upload?.media_info || upload?.video_info || {};
}

function uploadMediaType(upload = state.upload) {
  const info = currentUploadInfo(upload);
  return String(upload?.media_type || info.media_type || "video").toLowerCase();
}

function isImageUpload(upload = state.upload) {
  return uploadMediaType(upload) === "image";
}

function isVideoUpload(upload = state.upload) {
  return uploadMediaType(upload) === "video";
}

function isSupportedUploadFile(file) {
  if (!file || !file.name) {
    return false;
  }
  const name = String(file.name).toLowerCase();
  return SUPPORTED_UPLOAD_EXTENSIONS.some((ext) => name.endsWith(ext));
}

function formatSourceModeLabel(ffmpegAccel, sourceMediaType = uploadMediaType()) {
  if (String(sourceMediaType || "video").toLowerCase() === "image") {
    return "\u9759\u6001\u56FE\u7247";
  }
  return `FFmpeg ${formatFfmpegAccelLabel(ffmpegAccel)}`;
}

function formatMatteModeLabel(matte) {
  const mode = typeof matte === "string" ? matte : (matte?.mode || "chroma");
  let label = "\u7EAF\u8272\u62A0\u56FE";
  if (mode === "none") label = "\u4E0D\u62A0\u56FE";
  if (mode === "birefnet") label = "BiRefNet";
  if (mode === "birefnet_luma") label = "BiRefNet + Luma";
  if (mode !== "none" && typeof matte !== "string" && matte?.corridorkey_enabled) {
    label = `${label} + CorridorKey`;
  }
  return label;
}

function formatCorridorScreenLabel(value) {
  if (value === "blue") return "\u84DD\u5E55";
  if (value === "green") return "\u7EFF\u5E55";
  return "\u81EA\u52A8";
}

function formatMatteDetail(matte) {
  if (!matte) {
    return "";
  }
  if (matte.mode === "none") {
    return "";
  }
  const parts = [];
  if (matte.mode !== "chroma") {
    parts.push(matte.model_label || formatMatteModeLabel(matte));
  }
  if (matte.resolution) {
    parts.push(`${matte.resolution}px`);
  }
  if (matte.corridorkey_enabled) {
    const screen = formatCorridorScreenLabel(matte.corridorkey_screen_color);
    const device = matte.corridorkey_device ? ` / ${matte.corridorkey_device}` : "";
    parts.push(`CorridorKey ${screen}${device}`);
  }
  return parts.join(" / ");
}

function formatCanvasModeLabel(value) {
  if (value === "square_bottom") return "\u65B9\u5F62 / \u5E95\u90E8";
  if (value === "square_center") return "\u65B9\u5F62 / \u5C45\u4E2D";
  return "\u81EA\u52A8\u5BBD\u5EA6 / \u5C45\u4E2D";
}

async function importFromPath() {
  const path = els.pathInput.value.trim();
  if (!path) {
    setStatus("\u5148\u586B\u4E00\u4E2A\u672C\u5730\u89C6\u9891\u6216\u56FE\u7247\u7684\u7EDD\u5BF9\u8DEF\u5F84\u3002", "error");
    return;
  }

  await withBusy(els.importPathButton, async () => {
    setStatus("\u6B63\u5728\u5BFC\u5165\u672C\u5730\u7D20\u6750\u8DEF\u5F84...");
    const data = await apiJson("/api/import-path", {
      method: "POST",
      body: { path },
    });
    applyUpload(data.upload);
    setStatus(`\u5df2\u5bfc\u5165 ${data.upload.display_name}\u3002`, "success");
  });
}

async function handleUploadInputChange() {
  const [file] = els.uploadInput.files || [];
  await uploadSelectedFile(file);
  els.uploadInput.value = "";
}

async function uploadSelectedFile(file) {
  if (!file) {
    return;
  }
  if (!isSupportedUploadFile(file)) {
    setStatus("\u53EA\u652F\u6301\u89C6\u9891\u6216\u5355\u5F20\u56FE\u7247\uFF1A.mp4 / .mov / .mkv / .webm / .png / .jpg / .jpeg / .webp / .bmp\u3002", "error");
    return;
  }

  const form = new FormData();
  form.append("video", file);

  setUploadDropzoneBusy(true);
  await withBusy(els.importPathButton, async () => {
    try {
      setStatus(`\u6b63\u5728\u8F7D\u5165 ${file.name}...`);
      const response = await fetch("/api/upload", {
        method: "POST",
        body: form,
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.error || "\u4E0A\u4F20\u5931\u8D25");
      }
      applyUpload(data.upload);
      setStatus(`\u5DF2\u8F7D\u5165 ${data.upload.display_name}\u3002`, "success");
    } finally {
      setUploadDropzoneBusy(false);
      uploadDragDepth = 0;
      els.uploadDropzone.classList.remove("dragging");
      els.uploadInput.value = "";
    }
  });
}

function applyUpload(upload) {
  resetPreviewState();
  state.upload = upload;
  state.job = null;
  state.exportResult = null;
  state.processPreview = null;
  state.selected = new Set();

  const info = currentUploadInfo(upload);
  const mediaType = uploadMediaType(upload);
  state.segment.start = 0;
  state.segment.startFrame = 1;
  state.segment.endFrame = mediaType === "video" ? getSegmentFrameCount(upload) : 1;
  state.segment.end = mediaType === "video" ? segmentFrameToTime(getSegmentFrameCount(upload), "end", upload) : 0;
  state.segment.confirmed = true;
  normalizeSegment("end");

  els.videoName.textContent = upload.display_name || (mediaType === "image" ? "\u672a\u547d\u540d\u56fe\u7247" : "\u672a\u547d\u540d\u89c6\u9891");
  els.videoSize.textContent = info.width && info.height ? `${info.width} \u00d7 ${info.height}` : "-";
  els.videoFps.textContent = mediaType === "image" ? "\u5355\u5e27\u56fe\u7247" : (info.fps ? `${Number(info.fps).toFixed(2)} fps` : "-");
  els.videoDuration.textContent = mediaType === "image" ? "\u5355\u5f20\u56fe\u7247" : (Number(info.duration || 0) > 0 ? formatSeconds(info.duration) : "-");

  els.previewPanel.hidden = false;
  els.processPanel.hidden = false;
  els.resultPanel.hidden = true;
  els.exportResult.hidden = true;
  els.exportResult.innerHTML = "";
  els.frameGrid.innerHTML = "";
  els.jobSummary.innerHTML = "";
  resetProcessPreview();
  syncAnimationPreview();

  const mediaUrl = upload.media_url || upload.video_url;
  if (mediaType === "image") {
    els.videoPreview.pause();
    els.videoPreview.hidden = true;
    els.videoPreview.removeAttribute("src");
    els.videoPreview.load();
    els.mediaPreviewImage.src = mediaUrl;
    els.mediaPreviewImage.hidden = false;
  } else {
    els.mediaPreviewImage.hidden = true;
    els.mediaPreviewImage.removeAttribute("src");
    els.videoPreview.hidden = false;
    muteVideoPreview();
    els.videoPreview.src = mediaUrl;
    els.videoPreview.load();
  }
  syncSegmentBounds();
  renderSegmentControls();
  updateSegmentConfirmationUI();
  persistSession();
}

function resetProcessPreview() {
  state.processPreview = null;
  updateProcessPreviewZoom("source", 100, false);
  updateProcessPreviewZoom("processed", 100, false);
  els.previewSourceImage.hidden = true;
  els.previewProcessedImage.hidden = true;
  els.previewSourceImage.removeAttribute("src");
  els.previewProcessedImage.removeAttribute("src");
  els.previewSourceEmpty.hidden = false;
  els.previewProcessedEmpty.hidden = false;
  els.processPreviewTimeLabel.textContent = "\u53D6\u6837\u65F6\u95F4 -";
  els.processPreviewKeyLabel.textContent = "\u53D6\u6837\u65B9\u5F0F - / \u62A0\u56FE -";
}

function renderProcessPreview() {
  if (!state.processPreview) {
    resetProcessPreview();
    return;
  }

  const sourceModeLabel = formatSourceModeLabel(
    state.processPreview.ffmpeg_accel,
    state.processPreview.source_media_type || uploadMediaType()
  );
  els.previewSourceImage.src = state.processPreview.source_url;
  els.previewProcessedImage.src = state.processPreview.processed_url;
  els.previewSourceImage.hidden = false;
  els.previewProcessedImage.hidden = false;
  els.previewSourceEmpty.hidden = true;
  els.previewProcessedEmpty.hidden = true;
  els.processPreviewTimeLabel.textContent = isImageUpload()
    ? "\u5355\u5F20\u56FE\u7247\u9884\u89C8"
    : `\u53D6\u6837\u65F6\u95F4 ${formatSeconds(state.processPreview.sample_time || 0)}`;
  const matte = state.processPreview.matte || { mode: state.processPreview.options?.matte_mode || "chroma" };
  const matteLabel = formatMatteModeLabel(matte);
  const matteDetail = formatMatteDetail(matte);
  const chromaDetail = matte.mode === "chroma" ? ` / \u80CC\u666F\u8272 ${state.processPreview.key_color || "-"}` : "";
  els.processPreviewKeyLabel.textContent = `${sourceModeLabel} / ${matteLabel}${matteDetail ? ` / ${matteDetail}` : ""}${chromaDetail}`;
  persistSession();
}

function syncSegmentBounds() {
  if (isImageUpload()) {
    [els.startRange, els.endRange].forEach((element) => {
      element.step = "1";
      element.min = "1";
      element.max = "1";
    });
    [els.startInput, els.endInput].forEach((element) => {
      element.max = "1";
    });
    return;
  }
  const frameCount = getSegmentFrameCount();
  [els.startRange, els.endRange].forEach((element) => {
    element.step = "1";
    element.min = "1";
    element.max = String(frameCount);
  });
  [els.startInput, els.endInput].forEach((element) => {
    element.max = String(frameCount);
  });
}

function normalizeSegment(changedKey) {
  if (isImageUpload()) {
    state.segment.start = 0;
    state.segment.end = 0;
    state.segment.startFrame = 1;
    state.segment.endFrame = 1;
    return;
  }
  let startFrame = clampSegmentFrame(state.segment.startFrame);
  let endFrame = clampSegmentFrame(state.segment.endFrame);

  if (endFrame < startFrame) {
    if (changedKey === "start") {
      endFrame = startFrame;
    } else {
      startFrame = endFrame;
    }
  }

  state.segment.startFrame = startFrame;
  state.segment.endFrame = endFrame;
  syncSegmentTimesFromFrames();
}

function muteVideoPreview() {
  els.videoPreview.defaultMuted = true;
  els.videoPreview.muted = true;
  try {
    els.videoPreview.volume = 0;
  } catch (error) {}
}

function playVideoPreviewMuted() {
  muteVideoPreview();
  const playPromise = els.videoPreview.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {});
  }
}

function restartSegmentPlayback({ autoplay = true } = {}) {
  if (!state.upload || !isVideoUpload() || els.videoPreview.readyState < 1) {
    return;
  }
  const duration = Math.max(Number(currentUploadInfo().duration || 0), 0);
  const segmentStart = clamp(Number(state.segment.start || 0), 0, duration);
  els.videoPreview.currentTime = segmentStart;
  els.currentTimeLabel.textContent = `\u5f53\u524d ${formatSeconds(segmentStart)}`;
  updateVideoProgress(segmentStart);
  if (autoplay) {
    playVideoPreviewMuted();
  }
}

function updateVideoProgress(currentTime = 0) {
  if (!els.videoProgressFill) {
    return;
  }

  if (!state.upload || !isVideoUpload()) {
    els.videoProgressFill.style.width = "0%";
    return;
  }

  const duration = Math.max(Number(currentUploadInfo().duration || 0), 0);
  const segmentStart = clamp(Number(state.segment.start || 0), 0, duration);
  const segmentEnd = clamp(Number(state.segment.end || duration), segmentStart, duration);
  const segmentLength = Math.max(segmentEnd - segmentStart, 0.01);
  const normalizedCurrent = clamp(Number(currentTime || 0), segmentStart, segmentEnd);
  const progress = ((normalizedCurrent - segmentStart) / segmentLength) * 100;
  els.videoProgressFill.style.width = `${clamp(progress, 0, 100)}%`;
}

function renderSegmentControls() {
  const startFrame = clampSegmentFrame(state.segment.startFrame);
  const endFrame = clampSegmentFrame(state.segment.endFrame);
  els.startRange.value = String(startFrame);
  els.startInput.value = String(startFrame);
  els.endRange.value = String(endFrame);
  els.endInput.value = String(endFrame);
  els.segmentLength.textContent = `${Math.max(1, endFrame - startFrame + 1)} \u5E27`;
  updateVideoProgress(isVideoUpload() ? (els.videoPreview.currentTime || state.segment.start || 0) : 0);
}

function updateSegmentConfirmationUI() {
  const hasUpload = Boolean(state.upload);
  const isImage = isImageUpload();
  const startField = els.startRange.closest(".field");
  const endField = els.endRange.closest(".field");
  const segmentSummary = els.segmentLength.closest(".segment-summary");
  if (startField) startField.hidden = isImage;
  if (endField) endField.hidden = isImage;
  if (segmentSummary) segmentSummary.hidden = isImage;
  els.videoToolbar.hidden = isImage || !hasUpload;
  els.videoProgress.hidden = isImage || !hasUpload;

  if (isImage) {
    state.segment.start = 0;
    state.segment.end = 0;
    state.segment.confirmed = true;
    els.segmentConfirmStatus.className = "segment-status image";
    els.segmentConfirmStatus.textContent = "\u5355\u5F20\u56FE\u7247\u6A21\u5F0F";
    els.segmentConfirmHint.textContent = "\u65E0\u9700\u8C03\u6574\u65F6\u95F4\u8303\u56F4\u3002\u5F53\u524D\u53C2\u6570\u4F1A\u76F4\u63A5\u4F5C\u7528\u4E8E\u8FD9 1 \u5E27\u3002";
    els.previewFrameButton.disabled = !hasUpload;
    els.processButton.disabled = !hasUpload;
    els.processStepShell.classList.remove("locked");
    els.processLockNote.hidden = true;
    updateVideoProgress(0);
    return;
  }

  if (!hasUpload) {
    state.segment.confirmed = false;
    els.segmentConfirmStatus.className = "segment-status";
    els.segmentConfirmStatus.textContent = "\u5148\u5BFC\u5165\u7D20\u6750";
    els.segmentConfirmHint.textContent = "\u8F7D\u5165\u89C6\u9891\u540E\uFF0C\u8FD9\u91CC\u4F1A\u5B9E\u65F6\u9884\u89C8\u5E76\u5FAA\u73AF\u5F53\u524D\u9009\u533A\u3002";
    els.previewFrameButton.disabled = true;
    els.processButton.disabled = true;
    els.processStepShell.classList.add("locked");
    els.processLockNote.hidden = false;
    updateVideoProgress(0);
    return;
  }

  state.segment.confirmed = true;
  els.segmentConfirmStatus.className = "segment-status confirmed";
  els.segmentConfirmStatus.textContent = `\u5F53\u524D\u9009\u533A \u7B2C ${state.segment.startFrame} \u5E27 - \u7B2C ${state.segment.endFrame} \u5E27`;
  els.segmentConfirmHint.textContent = "\u62D6\u52A8\u8D77\u70B9\u6216\u7EC8\u70B9\u540E\uFF0C\u5DE6\u4FA7\u89C6\u9891\u4F1A\u7ACB\u5373\u8DF3\u56DE\u65B0\u8D77\u70B9\u5E76\u9759\u97F3\u5FAA\u73AF\u3002";
  els.previewFrameButton.disabled = false;
  els.processButton.disabled = false;
  els.processStepShell.classList.remove("locked");
  els.processLockNote.hidden = true;
  updateVideoProgress(els.videoPreview.currentTime || state.segment.start || 0);
}

async function processVideo() {
  if (!state.upload) {
    setStatus("\u5148\u5BFC\u5165\u89C6\u9891\u6216\u56FE\u7247\uFF0C\u518D\u5904\u7406\u3002", "error");
    return;
  }

  const payload = collectProcessingPayload();

  await withBusy(els.processButton, async () => {
    stopPreviewTimer();
    const matteMode = currentMatteMode();
    const usesCorridorKey = currentUsesCorridorKey();
    setStatus(
      usesCorridorKey
        ? matteMode.startsWith("birefnet")
          ? "\u6B63\u5728\u8FD0\u884C BiRefNet \u548C CorridorKey \u7CBE\u4FEE\u3002"
          : "\u6B63\u5728\u8FD0\u884C CorridorKey \u7CBE\u4FEE\u3002"
        : matteMode.startsWith("birefnet")
        ? "\u6B63\u5728\u8FD0\u884C BiRefNet AI \u62A0\u56FE\u3002"
        : isImageUpload()
        ? "\u6B63\u5728\u5904\u7406\u5355\u5F20\u56FE\u7247\u7684\u900F\u660E\u8FB9\u7F18\u548C\u7F29\u653E..."
        : "\u6b63\u5728\u62bd\u5e27\u5e76\u5904\u7406\u900f\u660e\u8fb9\u7f18\uff0c\u8fd9\u4e00\u6b65\u53ef\u80fd\u9700\u8981\u51e0\u5341\u79d2\u3002"
    );
    const data = await apiJson("/api/process", {
      method: "POST",
      body: payload,
    });
    state.job = data.job;
    state.exportResult = null;
    state.selected = new Set(data.job.frames.map((frame) => frame.index));
    state.preview.currentIndex = 0;
    renderJob();
    setStatus(
      `\u5904\u7406\u5b8c\u6210\uff0c\u5171\u5f97\u5230 ${data.job.frame_count} \u5e27\uff0c${formatSourceModeLabel(data.job.ffmpeg_accel, data.job.source_media_type)}\u3002`,
      "success"
    );
  });
}

async function previewCurrentFrame() {
  if (!state.upload) {
    setStatus("\u5148\u5BFC\u5165\u89C6\u9891\u6216\u56FE\u7247\uFF0C\u518D\u9884\u89C8\u53C2\u6570\u6548\u679C\u3002", "error");
    return;
  }

  const duration = Number(currentUploadInfo().duration || 0);
  const rawCurrentTime = isImageUpload() ? 0 : Number(els.videoPreview.currentTime || state.segment.start || 0);
  const sampleTime = clamp(rawCurrentTime, 0, Math.max(duration, 0));
  const payload = {
    ...collectProcessingPayload(),
    sample_time: sampleTime,
  };

  await withBusy(els.previewFrameButton, async () => {
    const matteMode = currentMatteMode();
    const usesCorridorKey = currentUsesCorridorKey();
    setStatus(
      usesCorridorKey
        ? matteMode.startsWith("birefnet")
          ? "\u6B63\u5728\u9884\u89C8 BiRefNet \u548C CorridorKey \u7CBE\u4FEE\u3002"
          : "\u6B63\u5728\u9884\u89C8 CorridorKey \u7CBE\u4FEE\u3002"
        : matteMode.startsWith("birefnet")
        ? "\u6B63\u5728\u7528 BiRefNet \u9884\u89C8\u5F53\u524D\u5E27\u62A0\u56FE\u3002"
        : isImageUpload()
        ? "\u6B63\u5728\u5957\u7528\u53C2\u6570\u9884\u89C8\u5355\u5F20\u56FE\u7247..."
        : "\u6b63\u5728\u62BD\u53D6\u5F53\u524D\u5E27\u5E76\u5957\u7528\u53C2\u6570..."
    );
    const data = await apiJson("/api/preview-frame", {
      method: "POST",
      body: payload,
    });
    state.processPreview = data.preview;
    renderProcessPreview();
    setStatus(
      isImageUpload()
        ? `\u5355\u5F20\u56FE\u7247\u9884\u89C8\u5DF2\u66F4\u65B0\uFF0C${formatSourceModeLabel(data.preview.ffmpeg_accel, data.preview.source_media_type)}\u3002`
        : `\u5355\u5E27\u9884\u89C8\u5DF2\u66F4\u65B0\uFF0C\u53D6\u6837\u65F6\u95F4 ${formatSeconds(sampleTime)}\uFF0C${formatSourceModeLabel(data.preview.ffmpeg_accel, data.preview.source_media_type)}\u3002`,
      "success"
    );
  });
}

function renderJob() {
  if (!state.job) {
    return;
  }

  const options = state.job.options || {};
  const keyColor = options.key_color || "#000000";
  const matte = options.matte || { mode: options.matte_mode || (options.chroma_enabled ? "chroma" : "none") };
  const matteDetail = formatMatteDetail(matte);
  const sourceMediaType = state.job.source_media_type || uploadMediaType();
  const outputWidth = options.output_width || options.target_size || "-";
  const outputHeight = options.output_height || options.target_size || "-";
  const segmentLabel = sourceMediaType === "image"
    ? "\u5355\u5F20\u56FE\u7247\u8F93\u5165"
    : `${formatSeconds(options.start_time || 0)} - ${formatSeconds(options.end_time || 0)}`;
  els.resultPanel.hidden = false;
  els.exportResult.hidden = true;
  const summaryCards = [
    summaryCard("\u4efb\u52a1 ID", escapeHtml(state.job.job_id)),
    summaryCard("\u8f93\u51fa\u5e27\u6570", `${state.job.frame_count} \u5e27`),
    summaryCard("\u53D6\u6837\u65B9\u5F0F", escapeHtml(formatSourceModeLabel(state.job.ffmpeg_accel, sourceMediaType))),
    summaryCard("\u62A0\u56FE\u6A21\u5F0F", escapeHtml(`${formatMatteModeLabel(matte)}${matteDetail ? ` / ${matteDetail}` : ""}`)),
    summaryCard("\u8F93\u51FA\u753B\u5E03", `${outputWidth} \u00d7 ${outputHeight}`),
    summaryCard("\u753B\u5E03\u5E03\u5C40", escapeHtml(formatCanvasModeLabel(options.canvas_mode))),
    summaryCard("\u62BD\u5E27\u95F4\u9694", sourceMediaType === "image" ? "\u5355\u5F20\u56FE\u7247" : `\u6BCF ${options.keep_every || 1} \u5E27\u4FDD\u7559\u4E00\u5F20`),
    summaryCard("\u8F93\u5165\u533A\u95F4", segmentLabel),
  ];
  if (matte.mode === "chroma") {
    summaryCards.push(`
      <div class="summary-card">
        <span class="meta-label">\u8bc6\u522b\u5230\u7684\u80cc\u666f\u8272</span>
        <strong class="swatch-row">
          <span class="swatch" style="background:${keyColor}"></span>
          <span>${escapeHtml(keyColor)}</span>
        </strong>
      </div>
    `);
  }
  els.jobSummary.innerHTML = summaryCards.join("");
  renderFrames();
  persistSession();
}

function renderFrames() {
  if (!state.job) {
    els.frameGrid.innerHTML = "";
    renderSelectionCount();
    syncAnimationPreview();
    return;
  }

  els.frameGrid.innerHTML = state.job.frames
    .map((frame) => {
      const checked = state.selected.has(frame.index);
      const frameNumber = String(frame.index + 1).padStart(3, "0");
      return `
        <label class="frame-card ${checked ? "selected" : ""}" data-index="${frame.index}">
          <div class="frame-check">
            <input type="checkbox" data-index="${frame.index}" ${checked ? "checked" : ""}>
          </div>
          <img src="${frame.thumb_url}" alt="frame ${frameNumber}">
          <div class="frame-meta">
            <span>#${frameNumber}</span>
            <span>${escapeHtml(frame.name)}</span>
          </div>
        </label>
      `;
    })
    .join("");
  renderSelectionCount();
  syncAnimationPreview();
  persistSession();
}

function renderSelectionCount() {
  const total = state.job?.frame_count || 0;
  els.selectionCount.textContent = `\u5df2\u9009 ${state.selected.size} / ${total} \u5e27`;
}

function refreshCardSelection(index, checked) {
  const card = els.frameGrid.querySelector(`.frame-card[data-index="${index}"]`);
  if (card) {
    card.classList.toggle("selected", checked);
  }
}

function selectFrames(predicate) {
  if (!state.job) return;
  state.selected = new Set(state.job.frames.filter(predicate).map((frame) => frame.index));
  state.preview.currentIndex = 0;
  renderFrames();
}

function getSelectedFrames() {
  if (!state.job) {
    return [];
  }
  return state.job.frames.filter((frame) => state.selected.has(frame.index));
}

function getSegmentFrameRate(upload = state.upload) {
  const fps = Number(currentUploadInfo(upload).fps || 0);
  return Number.isFinite(fps) && fps > 0 ? fps : 0;
}

function getSegmentFrameStep(upload = state.upload) {
  const fps = getSegmentFrameRate(upload);
  return fps > 0 ? 1 / fps : 0.01;
}

function getSegmentFrameCount(upload = state.upload) {
  if (isImageUpload(upload)) {
    return 1;
  }

  const fps = getSegmentFrameRate(upload);
  const duration = Math.max(Number(currentUploadInfo(upload).duration || 0), 0);
  if (fps <= 0 || duration <= 0) {
    return 1;
  }
  return Math.max(1, Math.round(duration * fps));
}

function clampSegmentFrame(frame, upload = state.upload) {
  return clamp(Math.round(Number(frame || 1)), 1, getSegmentFrameCount(upload));
}

function syncSegmentFramesFromTimes(upload = state.upload) {
  if (isImageUpload(upload)) {
    state.segment.startFrame = 1;
    state.segment.endFrame = 1;
    return;
  }

  state.segment.startFrame = timeToSegmentFrame(state.segment.start, "start", upload);
  state.segment.endFrame = timeToSegmentFrame(state.segment.end, "end", upload);
}

function syncSegmentTimesFromFrames(upload = state.upload) {
  if (isImageUpload(upload)) {
    state.segment.start = 0;
    state.segment.end = 0;
    state.segment.startFrame = 1;
    state.segment.endFrame = 1;
    return;
  }

  state.segment.startFrame = clampSegmentFrame(state.segment.startFrame, upload);
  state.segment.endFrame = clampSegmentFrame(state.segment.endFrame, upload);
  state.segment.start = segmentFrameToTime(state.segment.startFrame, "start", upload);
  state.segment.end = segmentFrameToTime(state.segment.endFrame, "end", upload);
}

function timeToSegmentFrame(value, key, upload = state.upload) {
  if (isImageUpload(upload)) {
    return 1;
  }

  const step = getSegmentFrameStep(upload);
  const snapped = snapSegmentTime(value, key === "start" ? "floor" : "ceil", upload);
  const rawFrame = key === "start" ? Math.round(snapped / step) + 1 : Math.round(snapped / step);
  return clampSegmentFrame(rawFrame, upload);
}

function segmentFrameToTime(frame, key, upload = state.upload) {
  if (isImageUpload(upload)) {
    return 0;
  }

  const clampedFrame = clampSegmentFrame(frame, upload);
  const step = getSegmentFrameStep(upload);
  const rawTime = key === "start" ? (clampedFrame - 1) * step : clampedFrame * step;
  return snapSegmentTime(rawTime, key === "start" ? "floor" : "ceil", upload);
}

function getSegmentFrameValue(key, upload = state.upload) {
  return timeToSegmentFrame(key === "start" ? state.segment.start : state.segment.end, key, upload);
}

function getSelectedSegmentFrameCount(upload = state.upload) {
  if (isImageUpload(upload)) {
    return 1;
  }
  const startFrame = getSegmentFrameValue("start", upload);
  const endFrame = getSegmentFrameValue("end", upload);
  return Math.max(1, endFrame - startFrame + 1);
}

function formatSegmentStep(upload = state.upload) {
  return getSegmentFrameStep(upload).toFixed(8).replace(/0+$/u, "").replace(/\.$/u, "");
}

function snapSegmentTime(value, mode = "round", upload = state.upload) {
  if (isImageUpload(upload)) {
    return 0;
  }

  const duration = Math.max(Number(currentUploadInfo(upload).duration || 0), 0);
  const step = Math.max(getSegmentFrameStep(upload), 1e-6);
  const clampedValue = clamp(Number(value || 0), 0, duration);
  const framePosition = clampedValue / step;

  let frameIndex = Math.round(framePosition);
  if (mode === "floor") {
    frameIndex = Math.floor(framePosition + 1e-9);
  } else if (mode === "ceil") {
    frameIndex = Math.ceil(framePosition - 1e-9);
  }

  const snapped = clamp(frameIndex * step, 0, duration);
  return Number(snapped.toFixed(8));
}

function normalizePreviewInterval() {
  const value = Number(els.previewIntervalInput.value || 100);
  const normalized = clamp(Math.round(value), 20, 5000);
  els.previewIntervalInput.value = String(normalized);
  return normalized;
}

function normalizeHexColor(value, fallback = "#F6FBF6") {
  const raw = String(value || "").trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(raw)) {
    return raw;
  }
  return fallback;
}

function setPreviewStageBackground(color) {
  const normalized = normalizeHexColor(color, state.preview.background);
  const stage = els.animationPreviewCanvas?.closest(".animation-stage");
  if (stage) {
    stage.style.setProperty("--preview-bg-color", normalized);
  }
}

function updatePreviewBackground(color, shouldPersist = false) {
  const normalized = normalizeHexColor(color);
  state.preview.background = normalized;
  els.previewBackgroundInput.value = normalized;
  els.previewBackgroundLabel.textContent = normalized;
  setPreviewStageBackground(normalized);
  if (shouldPersist) {
    persistSession();
  }
}

function resetPreviewState() {
  stopPreviewTimer();
  state.preview.currentIndex = 0;
  state.preview.isPlaying = true;
  state.preview.renderToken += 1;
  state.preview.imageCache.clear();
}

function stopPreviewTimer() {
  state.preview.warmupToken += 1;
  if (state.preview.rafId !== null) {
    window.cancelAnimationFrame(state.preview.rafId);
    state.preview.rafId = null;
  }
}

function restartPreviewTimer() {
  stopPreviewTimer();
  const selectedFrames = getSelectedFrames();
  if (!state.preview.isPlaying || selectedFrames.length <= 1) {
    updatePreviewControls(selectedFrames.length);
    return;
  }

  const warmupToken = state.preview.warmupToken;
  const startLoop = () => {
    if (warmupToken !== state.preview.warmupToken || !state.preview.isPlaying) {
      return;
    }

    let lastAdvanceAt = performance.now();
    const tick = (now) => {
      if (warmupToken !== state.preview.warmupToken) {
        return;
      }

      const frames = getSelectedFrames();
      const frameCount = frames.length;
      if (!state.preview.isPlaying || frameCount <= 1) {
        stopPreviewTimer();
        updatePreviewControls(frameCount);
        return;
      }

      if (state.preview.currentIndex >= frameCount) {
        state.preview.currentIndex = 0;
        drawPreviewFrameFromCache(frames[0], frameCount);
      }

      const intervalMs = normalizePreviewInterval();
      const elapsed = now - lastAdvanceAt;
      if (elapsed >= intervalMs) {
        const steps = Math.max(1, Math.floor(elapsed / intervalMs));
        lastAdvanceAt += steps * intervalMs;
        state.preview.currentIndex = (state.preview.currentIndex + steps) % frameCount;
        drawPreviewFrameFromCache(frames[state.preview.currentIndex], frameCount);
      }

      state.preview.rafId = window.requestAnimationFrame(tick);
    };

    state.preview.rafId = window.requestAnimationFrame(tick);
  };

  if (selectedFrames.every((frame) => getCachedPreviewImage(frame.url))) {
    startLoop();
    updatePreviewControls(selectedFrames.length);
    return;
  }

  warmPreviewFrames(selectedFrames)
    .then(() => {
      startLoop();
    })
    .catch((error) => {
      if (warmupToken !== state.preview.warmupToken) {
        return;
      }
      setStatus(error.message || String(error), "error");
    });
  updatePreviewControls(selectedFrames.length);
}

function togglePreviewPlayback() {
  const selectedFrames = getSelectedFrames();
  if (selectedFrames.length === 0) {
    return;
  }
  state.preview.isPlaying = !state.preview.isPlaying;
  if (state.preview.isPlaying) {
    restartPreviewTimer();
  } else {
    stopPreviewTimer();
    updatePreviewControls(selectedFrames.length);
  }
  persistSession();
}

function restartPreviewPlayback() {
  state.preview.currentIndex = 0;
  syncAnimationPreview();
  persistSession();
}

function updatePreviewControls(selectedCount) {
  const hasFrames = selectedCount > 0;
  const canAnimate = selectedCount > 1;
  const currentIndex = hasFrames ? Math.min(state.preview.currentIndex, selectedCount - 1) : 0;
  const progressPercent = hasFrames ? ((currentIndex + 1) / selectedCount) * 100 : 0;
  els.previewPlayPauseButton.disabled = !canAnimate;
  els.previewRestartButton.disabled = !hasFrames;
  els.previewProgressFill.style.width = `${progressPercent}%`;
  els.previewProgressLabel.textContent = hasFrames
    ? `${currentIndex + 1} / ${selectedCount}`
    : "0 / 0";
  els.previewPlayPauseButton.textContent = canAnimate
    ? (state.preview.isPlaying ? "\u6682\u505c\u9884\u89c8" : "\u64ad\u653e\u9884\u89c8")
    : "\u5355\u5E27\u9884\u89C8";
  els.previewSelectedCount.textContent = `\u5df2\u52a0\u8f7d ${selectedCount} \u5e27`;
}

async function loadPreviewImage(url) {
  const cached = state.preview.imageCache.get(url);
  if (cached) {
    return cached instanceof HTMLImageElement ? Promise.resolve(cached) : cached;
  }

  const promise = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      state.preview.imageCache.set(url, image);
      resolve(image);
    };
    image.onerror = () => {
      state.preview.imageCache.delete(url);
      reject(new Error(`\u9884\u89c8\u5E27\u52A0\u8F7D\u5931\u8D25: ${url}`));
    };
    image.src = url;
  });

  state.preview.imageCache.set(url, promise);
  return promise;
}

function getCachedPreviewImage(url) {
  const cached = state.preview.imageCache.get(url);
  return cached instanceof HTMLImageElement ? cached : null;
}

function warmPreviewFrames(frames) {
  return Promise.all(frames.map((frame) => loadPreviewImage(frame.url)));
}

function drawPreviewPlaceholder() {
  const canvas = els.animationPreviewCanvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = state.preview.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  els.previewEmptyState.hidden = false;
  els.previewFrameLabel.textContent = "\u5F53\u524D -";
}

function renderPreviewFrameImage(image, frame, selectedCount) {
  const canvas = els.animationPreviewCanvas;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = state.preview.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  const baseScale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const scale = baseScale >= 1 ? Math.max(1, Math.floor(baseScale)) : baseScale;
  const drawWidth = image.naturalWidth * scale;
  const drawHeight = image.naturalHeight * scale;
  const drawX = Math.round((canvas.width - drawWidth) / 2);
  const drawY = Math.round((canvas.height - drawHeight) / 2);
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);

  els.previewEmptyState.hidden = true;
  els.previewFrameLabel.textContent = `\u5F53\u524D #${String(frame.index + 1).padStart(3, "0")}`;
  updatePreviewControls(selectedCount);
}

async function drawPreviewFrame(frame, selectedCount) {
  if (!frame) {
    drawPreviewPlaceholder();
    updatePreviewControls(selectedCount);
    return;
  }

  const token = ++state.preview.renderToken;
  try {
    const image = await loadPreviewImage(frame.url);
    if (token !== state.preview.renderToken) {
      return;
    }
    renderPreviewFrameImage(image, frame, selectedCount);
  } catch (error) {
    drawPreviewPlaceholder();
    setStatus(error.message || String(error), "error");
  }
}

function drawPreviewFrameFromCache(frame, selectedCount) {
  if (!frame) {
    drawPreviewPlaceholder();
    updatePreviewControls(selectedCount);
    return;
  }

  state.preview.renderToken += 1;
  const image = getCachedPreviewImage(frame.url);
  if (!image) {
    void drawPreviewFrame(frame, selectedCount);
    return;
  }

  renderPreviewFrameImage(image, frame, selectedCount);
}

function syncAnimationPreview(shouldRestartTimer = true) {
  const selectedFrames = getSelectedFrames();
  const selectedCount = selectedFrames.length;

  if (selectedCount === 0) {
    stopPreviewTimer();
    state.preview.currentIndex = 0;
    updatePreviewControls(0);
    drawPreviewPlaceholder();
    return;
  }

  if (state.preview.currentIndex >= selectedCount) {
    state.preview.currentIndex = 0;
  }

  const currentFrame = selectedFrames[state.preview.currentIndex];
  drawPreviewFrameFromCache(currentFrame, selectedCount);
  void warmPreviewFrames(selectedFrames);
  if (shouldRestartTimer) {
    restartPreviewTimer();
  }
}

async function exportFrames() {
  if (!state.job) {
    setStatus("\u8fd8\u6ca1\u6709\u53ef\u5bfc\u51fa\u7684\u5904\u7406\u7ed3\u679c\u3002", "error");
    return;
  }
  if (state.selected.size === 0) {
    setStatus("\u81f3\u5c11\u9009\u4e00\u5e27\u518d\u5bfc\u51fa\u3002", "error");
    return;
  }

  await withBusy(els.exportButton, async () => {
    setStatus("\u6b63\u5728\u5bfc\u51fa\u9009\u4e2d\u5e27...");
    const data = await apiJson("/api/export", {
      method: "POST",
      body: {
        job_id: state.job.job_id,
        selected_indices: Array.from(state.selected).sort((a, b) => a - b),
        sheet_columns: Number(els.sheetColumnsInput.value || 4),
      },
    });
    state.exportResult = data.export;
    renderExportResult();
    setStatus("\u5bfc\u51fa\u5b8c\u6210\uff0c\u7ed3\u679c\u5df2\u5199\u5165\u672c\u5730\u5bfc\u51fa\u76ee\u5f55\u3002", "success");
  });
}

function renderExportResult() {
  if (!state.exportResult) {
    els.exportResult.hidden = true;
    els.exportResult.innerHTML = "";
    return;
  }

  els.exportResult.hidden = false;
  els.exportResult.innerHTML = `
    <div class="result-summary">
      ${summaryCard("\u5bfc\u51fa\u5e27\u6570", `${state.exportResult.frame_count} \u5e27`)}
      ${summaryCard("\u5bfc\u51fa\u5185\u5bb9", "PNG \u5e27 / sprite sheet / zip / manifest")}
    </div>
    <div class="link-list">
      <button id="openExportDirButton" class="ghost-button" type="button">\u6253\u5f00\u5bfc\u51fa\u76ee\u5f55</button>
      <a href="${state.exportResult.zip_url}" target="_blank" rel="noopener">frames.zip</a>
      <a href="${state.exportResult.sheet_url}" target="_blank" rel="noopener">sprite_sheet.png</a>
      <a href="${state.exportResult.manifest_url}" target="_blank" rel="noopener">export.json</a>
    </div>
  `;

  const openExportDirButton = document.getElementById("openExportDirButton");
  if (openExportDirButton) {
    openExportDirButton.addEventListener("click", async () => {
      await openPath(state.exportResult.output_dir);
    });
  }
  persistSession();
}

function summaryCard(label, value) {
  return `
    <div class="summary-card">
      <span class="meta-label">${label}</span>
      <strong>${value}</strong>
    </div>
  `;
}

function formatFfmpegAccelLabel(ffmpegAccel) {
  if (!ffmpegAccel || typeof ffmpegAccel !== "object") {
    return "CPU";
  }

  const usedMode = String(ffmpegAccel.used_mode || "cpu").toLowerCase();
  const selectedMode = ffmpegAccel.selected_mode ? String(ffmpegAccel.selected_mode).toLowerCase() : "";
  const requestedMode = String(ffmpegAccel.requested_mode || "auto").toLowerCase();

  if (usedMode !== "cpu") {
    return `GPU (${usedMode})`;
  }
  if (ffmpegAccel.fallback_to_cpu && selectedMode) {
    return `CPU (${selectedMode} fallback)`;
  }
  if (requestedMode === "cpu") {
    return "CPU (manual)";
  }
  return "CPU";
}

function updateChromaVisibility() {
  const matteMode = currentMatteMode();
  const chromaEnabled = matteMode !== "none";
  const isChroma = chromaEnabled && matteMode === "chroma";
  const isAi = chromaEnabled && matteMode.startsWith("birefnet");
  const isLuma = chromaEnabled && matteMode === "birefnet_luma";
  const isCorridorCapable = chromaEnabled;
  const isCorridor = isCorridorCapable && els.corridorEnabledInput.checked;
  const usesSpillControls = isChroma || isAi || isCorridor;
  const isManual = els.keyModeInput.value === "manual";
  els.matteModeInput.disabled = !els.chromaEnabledInput.checked;
  els.keyModeInput.closest(".field").style.display = usesSpillControls ? "" : "none";
  els.manualColorField.style.display = usesSpillControls && isManual ? "" : "none";
  document.querySelectorAll(".chroma-only").forEach((node) => {
    node.style.display = isChroma ? "" : "none";
  });
  document.querySelectorAll(".spill-matte-only").forEach((node) => {
    node.style.display = usesSpillControls ? "" : "none";
  });
  document.querySelectorAll(".ai-matte-only").forEach((node) => {
    node.style.display = isAi ? "" : "none";
  });
  document.querySelectorAll(".luma-matte-only").forEach((node) => {
    node.style.display = isLuma ? "" : "none";
  });
  document.querySelectorAll(".corridor-capable-only").forEach((node) => {
    node.style.display = isCorridorCapable ? "" : "none";
  });
  document.querySelectorAll(".corridor-key-only").forEach((node) => {
    node.style.display = isCorridor ? "" : "none";
  });
}

function syncManualColorLabel() {
  els.manualKeyLabel.textContent = (els.manualKeyInput.value || "#00ff00").toUpperCase();
}

async function openPath(path) {
  try {
    await apiJson("/api/open-path", {
      method: "POST",
      body: { path },
    });
  } catch (error) {
    setStatus(`\u6253\u5f00\u76ee\u5f55\u5931\u8d25\uff1a${error.message}`, "error");
  }
}

async function apiJson(url, options = {}) {
  const fetchOptions = { ...options };
  if (fetchOptions.body && !(fetchOptions.body instanceof FormData)) {
    fetchOptions.headers = {
      "Content-Type": "application/json",
      ...(fetchOptions.headers || {}),
    };
    fetchOptions.body = JSON.stringify(fetchOptions.body);
  }

  const response = await fetch(url, fetchOptions);
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function withBusy(button, task) {
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  } finally {
    button.disabled = false;
  }
}

function setStatus(message, tone = "") {
  els.appStatus.textContent = message;
  els.appStatus.className = `status-message${tone ? ` ${tone}` : ""}`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatSeconds(value) {
  return `${Number(value || 0).toFixed(2)}s`;
}
