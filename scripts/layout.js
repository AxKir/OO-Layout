/**
 * OO-Layout Plugin – scripts/layout.js
 *
 * Provides a right-panel UI for the Presentation (slide) editor that
 * consolidates size, position, rotation, alignment and distribution
 * controls that are otherwise scattered across menus.
 *
 * Coordinate / size unit used by the DocBuilder API: 1/36000 of a cm (EMU).
 * For display we convert to millimetres (1 mm = 36000 EMU).
 */

(function () {
  "use strict";

  // ─── Constants ─────────────────────────────────────────────────────────────

  /** 1 mm in EMU */
  var MM_TO_EMU = 36000;

  // ─── State ─────────────────────────────────────────────────────────────────

  /**
   * @type {{ x: number, y: number, w: number, h: number, rot: number,
   *          id: string|null }[]}
   */
  var selectedObjects = [];

  /** Aspect ratio of the first selected object (w/h), null when not locked */
  var aspectRatio = null;

  /** Prevent overlapping refresh calls that can lag/freeze the panel */
  var refreshInFlight = false;
  var refreshQueued = false;
  var refreshTimer = null;

  // ─── DOM references ────────────────────────────────────────────────────────

  var elSelectionStatus = document.getElementById("selection-status");
  var elControls        = document.getElementById("layout-controls");
  var elSectionSize     = document.getElementById("section-size");
  var elSectionPosition = document.getElementById("section-position");
  var elSectionRotation = document.getElementById("section-rotation");
  var elSectionAlign    = document.getElementById("section-align");
  var elSectionDistrib  = document.getElementById("section-distribute");
  var elWidth           = document.getElementById("input-width");
  var elHeight          = document.getElementById("input-height");
  var elX               = document.getElementById("input-x");
  var elY               = document.getElementById("input-y");
  var elRotation        = document.getElementById("input-rotation");
  var elLockAspect      = document.getElementById("lock-aspect");

  function executeCommandAndRefresh(script) {
    window.Asc.plugin.callCommand(new Function(script), false, true, function () { // eslint-disable-line no-new-func
      loadSelectedDrawings(function (drawings) {
        var normalized = normalizeSelectedObjects(drawings);
        if (normalized.length > 0 && hasUsableMetrics(normalized[0])) {
          applySelection(normalized);
          return;
        }

        refreshSelection();
      });
    });
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  function emuToMm(emu) {
    return Math.round(emu / MM_TO_EMU * 10) / 10; // one decimal place
  }

  function mmToEmu(mm) {
    return Math.round(parseFloat(mm) * MM_TO_EMU);
  }

  function setInputValue(el, value) {
    el.value = value !== null && value !== undefined ? value : "";
  }

  function getNumericProperty(object, names, fallback) {
    var i;
    for (i = 0; i < names.length; i++) {
      if (object && object[names[i]] !== undefined && object[names[i]] !== null) {
        return object[names[i]];
      }
    }
    return fallback;
  }

  function getNestedNumericProperty(object, paths) {
    var i;
    for (i = 0; i < paths.length; i++) {
      var path = paths[i];
      var current = object;
      var j;
      for (j = 0; j < path.length; j++) {
        if (!current || current[path[j]] === undefined || current[path[j]] === null) {
          current = null;
          break;
        }
        current = current[path[j]];
      }

      if (typeof current === "number" && !isNaN(current)) {
        return current;
      }
    }

    return null;
  }

  function getObjectMetrics(object) {
    var width = getNumericProperty(object, ["Width", "W", "width", "w"], null);
    var height = getNumericProperty(object, ["Height", "H", "height", "h"], null);
    var x = getNumericProperty(object, ["X", "Left", "PosX", "x", "left"], null);
    var y = getNumericProperty(object, ["Y", "Top", "PosY", "y", "top"], null);
    var rot = getNumericProperty(object, ["Rot", "Rotation", "Angle", "rot", "rotation", "angle"], null);

    if (width === null) {
      width = getNestedNumericProperty(object, [
        ["Size", "Width"], ["Size", "W"], ["size", "width"], ["size", "w"],
        ["Transform", "ExtX"], ["transform", "extX"],
        ["Bounds", "W"], ["Bounds", "Width"], ["bounds", "w"], ["bounds", "width"]
      ]);
    }

    if (height === null) {
      height = getNestedNumericProperty(object, [
        ["Size", "Height"], ["Size", "H"], ["size", "height"], ["size", "h"],
        ["Transform", "ExtY"], ["transform", "extY"],
        ["Bounds", "H"], ["Bounds", "Height"], ["bounds", "h"], ["bounds", "height"]
      ]);
    }

    if (x === null) {
      x = getNestedNumericProperty(object, [
        ["Position", "X"], ["Position", "Left"], ["position", "x"], ["position", "left"],
        ["Transform", "OffX"], ["transform", "offX"],
        ["Bounds", "X"], ["Bounds", "Left"], ["bounds", "x"], ["bounds", "left"]
      ]);
    }

    if (y === null) {
      y = getNestedNumericProperty(object, [
        ["Position", "Y"], ["Position", "Top"], ["position", "y"], ["position", "top"],
        ["Transform", "OffY"], ["transform", "offY"],
        ["Bounds", "Y"], ["Bounds", "Top"], ["bounds", "y"], ["bounds", "top"]
      ]);
    }

    if (rot === null) {
      rot = getNestedNumericProperty(object, [
        ["Transform", "Rot"], ["Transform", "Rotation"], ["transform", "rot"], ["transform", "rotation"]
      ]);
    }

    return {
      x: x,
      y: y,
      w: width,
      h: height,
      rot: rot
    };
  }

  function hasUsableMetrics(object) {
    var m = getObjectMetrics(object || {});
    return m.w !== null || m.h !== null || m.x !== null || m.y !== null || m.rot !== null;
  }

  function setSectionDisabled(section, disabled) {
    if (!section) {
      return;
    }

    section.classList.toggle("is-disabled", disabled);

    Array.prototype.forEach.call(section.querySelectorAll("input, button"), function (control) {
      control.disabled = disabled;
    });
  }

  function setSelectionStatus(count) {
    if (!elSelectionStatus) {
      return;
    }

    if (count > 0) {
      elSelectionStatus.textContent = count + " object" + (count === 1 ? "" : "s") + " selected";
      elSelectionStatus.classList.add("has-selection");
    } else {
      elSelectionStatus.textContent = "No object selected";
      elSelectionStatus.classList.remove("has-selection");
    }
  }

  function updateUiFromSelection(objects) {
    var hasSelection = objects && objects.length > 0;
    var isSingleSelection = objects && objects.length === 1;
    var isMultiSelection = objects && objects.length > 1;

    setSelectionStatus(objects ? objects.length : 0);

    if (!hasSelection) {
      setInputValue(elWidth, "");
      setInputValue(elHeight, "");
      setInputValue(elX, "");
      setInputValue(elY, "");
      setInputValue(elRotation, "");
      aspectRatio = null;
    } else {
      var first = objects[0] || {};
      var metrics = getObjectMetrics(first);

      if (isSingleSelection) {
        setInputValue(elWidth, metrics.w !== null ? emuToMm(metrics.w) : "");
        setInputValue(elHeight, metrics.h !== null ? emuToMm(metrics.h) : "");
        setInputValue(elX, metrics.x !== null ? emuToMm(metrics.x) : "");
        setInputValue(elY, metrics.y !== null ? emuToMm(metrics.y) : "");
        setInputValue(elRotation, metrics.rot !== null ? metrics.rot : "");

        aspectRatio = (typeof metrics.w === "number" && typeof metrics.h === "number" && metrics.h !== 0)
          ? metrics.w / metrics.h
          : null;
      } else {
        setInputValue(elWidth, "");
        setInputValue(elHeight, "");
        setInputValue(elX, "");
        setInputValue(elY, "");
        setInputValue(elRotation, "");
        aspectRatio = null;
      }
    }

    setSectionDisabled(elSectionSize, !hasSelection);
    setSectionDisabled(elSectionPosition, !hasSelection);
    setSectionDisabled(elSectionRotation, !hasSelection);
    setSectionDisabled(elSectionAlign, !hasSelection);
    setSectionDisabled(elSectionDistrib, !isMultiSelection);

    if (elLockAspect) {
      elLockAspect.disabled = !isSingleSelection;
    }

  }

  function normalizeSelectedObjects(result) {
    function normalizeItem(item) {
      if (!item || typeof item !== "object") {
        return null;
      }

      // Some editor builds return descriptors in the form:
      // { Type: "Shape", Value: { Width, Height, X, Y, ... } }
      if (item.Value && typeof item.Value === "object") {
        var merged = {};
        var key;
        for (key in item.Value) {
          if (Object.prototype.hasOwnProperty.call(item.Value, key)) {
            merged[key] = item.Value[key];
          }
        }
        if (item.Type !== undefined) {
          merged.Type = item.Type;
        }
        return merged;
      }

      return item;
    }

    if (Array.isArray(result)) {
      return result.map(normalizeItem).filter(function (item) {
        return !!item;
      });
    }

    if (!result) {
      return [];
    }

    if (Array.isArray(result.selectedObjects)) {
      return result.selectedObjects.map(normalizeItem).filter(function (item) {
        return !!item;
      });
    }

    if (Array.isArray(result.objects)) {
      return result.objects.map(normalizeItem).filter(function (item) {
        return !!item;
      });
    }

    if (Array.isArray(result.items)) {
      return result.items.map(normalizeItem).filter(function (item) {
        return !!item;
      });
    }

    return [];
  }

  function loadSelectedDrawings(callback) {
    window.Asc.plugin.callCommand(function () {
      var result = [];
      var selection = Api.GetSelection ? Api.GetSelection() : null;
      if (!selection) {
        return result;
      }

      if (selection.IsEmpty && selection.IsEmpty()) {
        return result;
      }

      var drawings = selection.GetShapes ? selection.GetShapes() : [];

      var i;
      for (i = 0; i < drawings.length; i++) {
        var drawing = drawings[i];

        result.push({
          X: drawing.GetPosX ? drawing.GetPosX() : null,
          Y: drawing.GetPosY ? drawing.GetPosY() : null,
          Width: drawing.GetWidth ? drawing.GetWidth() : null,
          Height: drawing.GetHeight ? drawing.GetHeight() : null,
          Rot: drawing.GetRotation ? drawing.GetRotation() : null,
          Name: drawing.GetName ? drawing.GetName() : ""
        });
      }

      return result;
    }, false, false, function (objects) {
      callback(Array.isArray(objects) ? objects : []);
    });
  }

  function loadSelectedObjectsViaMethod(callback) {
    window.Asc.plugin.executeMethod("GetSelectedObjects", [], function (objects) {
      callback(normalizeSelectedObjects(objects));
    });
  }

  function applySelection(objects) {
    selectedObjects = normalizeSelectedObjects(objects);

    if (selectedObjects.length === 1) {
      var m = getObjectMetrics(selectedObjects[0] || {});
      aspectRatio = (typeof m.w === "number" && typeof m.h === "number" && m.h !== 0)
        ? m.w / m.h
        : null;
    } else {
      aspectRatio = null;
    }

    updateUiFromSelection(selectedObjects);
  }

  function fetchSelectedObjects(callback) {
    loadSelectedObjectsViaMethod(function (selected) {
      if (selected.length > 0 && hasUsableMetrics(selected[0])) {
        callback(selected);
        return;
      }

      // Get reliable geometry when method payload contains descriptors only.
      loadSelectedDrawings(function (drawings) {
        var normalized = normalizeSelectedObjects(drawings);
        if (normalized.length > 0 && hasUsableMetrics(normalized[0])) {
          callback(normalized);
          return;
        }

        // Keep descriptor selection if available so controls remain enabled.
        if (selected.length > 0) {
          callback(selected);
          return;
        }

        // Final fallback: infer object selection by type.
        window.Asc.plugin.executeMethod("GetSelectionType", [], function (selectionType) {
          var type = typeof selectionType === "string" ? selectionType.toLowerCase() : "";
          var looksLikeObjectSelection = type === "drawing"
            || type === "shape"
            || type === "object"
            || type === "image"
            || type === "chart"
            || type === "group";

          callback(looksLikeObjectSelection ? [{}] : []);
        });
      });
    });
  }

  // ─── Apply size / position / rotation ──────────────────────────────────────

  /**
   * Builds a DocBuilder script that resizes and repositions the currently
   * selected shapes on the active slide.
   * All parameters are optional – empty inputs are skipped.
   */
  function buildApplyScript(newW, newH, newX, newY, newRot) {
      return "var selection = Api.GetSelection ? Api.GetSelection() : null;"
        + "if (!selection) { return; }"
        + "var shapes = selection.GetShapes ? selection.GetShapes() : [];"
         + "var i, s;"
         + "for (i = 0; i < shapes.length; i++) {"
         + "  s = shapes[i];"
         + (newW !== null && newH !== null
              ? "  s.SetSize(" + newW + "," + newH + ");"
              : "")
         + (newX !== null && newY !== null
              ? "  s.SetPosition(" + newX + "," + newY + ");"
              : "")
         + (newRot !== null
              ? "  if (s.SetRotation) { s.SetRotation(" + newRot + "); }"
              : "")
         + "}";
  }

  function applyLayoutValues() {
    var wRaw   = elWidth.value.trim();
    var hRaw   = elHeight.value.trim();
    var xRaw   = elX.value.trim();
    var yRaw   = elY.value.trim();
    var rotRaw = elRotation.value.trim();

    var newW   = wRaw   !== "" ? mmToEmu(wRaw)   : null;
    var newH   = hRaw   !== "" ? mmToEmu(hRaw)   : null;
    var newX   = xRaw   !== "" ? mmToEmu(xRaw)   : null;
    var newY   = yRaw   !== "" ? mmToEmu(yRaw)   : null;
    var newRot = rotRaw !== "" ? parseFloat(rotRaw) : null;

    // For single selection, allow changing only one dimension/coordinate by
    // filling missing pair values from the current object geometry.
    if (selectedObjects.length === 1) {
      var current = getObjectMetrics(selectedObjects[0] || {});
      if (newW !== null && newH === null && current.h !== null) {
        newH = current.h;
      } else if (newH !== null && newW === null && current.w !== null) {
        newW = current.w;
      }

      if (newX !== null && newY === null && current.y !== null) {
        newY = current.y;
      } else if (newY !== null && newX === null && current.x !== null) {
        newX = current.x;
      }
    }

    // Enforce aspect ratio on single-selection when lock is active
    if (selectedObjects.length === 1 && elLockAspect.checked && aspectRatio) {
      if (newW !== null && hRaw === "") {
        newH = Math.round(newW / aspectRatio);
        setInputValue(elHeight, emuToMm(newH));
      } else if (newH !== null && wRaw === "") {
        newW = Math.round(newH * aspectRatio);
        setInputValue(elWidth, emuToMm(newW));
      }
    }

    var script = buildApplyScript(newW, newH, newX, newY, newRot);

    executeCommandAndRefresh(script);
  }

  // ─── Alignment ─────────────────────────────────────────────────────────────

  /**
   * Maps button data-align attribute values to the DocBuilder align commands
   * available in the presentation API.
   * See: https://api.onlyoffice.com/docbuilder/presentationapi/ApiShape/SetAlignObject
   */
  var ALIGN_MAP = {
    "left":     "left",
    "center-h": "center",
    "right":    "right",
    "top":      "top",
    "center-v": "ctr",
    "bottom":   "bottom"
  };

  function buildAlignScript(alignType) {
      return "var pres = Api.GetPresentation ? Api.GetPresentation() : null;"
         + "var selection = Api.GetSelection ? Api.GetSelection() : null;"
        + "if (!pres || !selection) { return; }"
         + "var shapes = selection.GetShapes ? selection.GetShapes() : [];"
        + "if (shapes.length < 2) { return; }"
        + "var i, s, x, y, w, h, nx, ny;"
        + "var minX = null, minY = null, maxX = null, maxY = null;"
        + "for (i = 0; i < shapes.length; i++) {"
        + "  s = shapes[i];"
        + "  x = s.GetPosX ? s.GetPosX() : null;"
        + "  y = s.GetPosY ? s.GetPosY() : null;"
        + "  w = s.GetWidth ? s.GetWidth() : null;"
        + "  h = s.GetHeight ? s.GetHeight() : null;"
        + "  if (x === null || y === null || w === null || h === null) { continue; }"
        + "  if (minX === null || x < minX) { minX = x; }"
        + "  if (minY === null || y < minY) { minY = y; }"
        + "  if (maxX === null || (x + w) > maxX) { maxX = x + w; }"
        + "  if (maxY === null || (y + h) > maxY) { maxY = y + h; }"
        + "}"
        + "if (minX === null || minY === null || maxX === null || maxY === null) { return; }"
        + "var centerX = Math.round((minX + maxX) / 2);"
        + "var centerY = Math.round((minY + maxY) / 2);"
         + "for (i = 0; i < shapes.length; i++) {"
         + "  s = shapes[i];"
         + "  x = s.GetPosX ? s.GetPosX() : null;"
         + "  y = s.GetPosY ? s.GetPosY() : null;"
         + "  w = s.GetWidth ? s.GetWidth() : null;"
         + "  h = s.GetHeight ? s.GetHeight() : null;"
         + "  if (x === null || y === null) { continue; }"
         + "  nx = x;"
         + "  ny = y;"
        + (alignType === "left" ? "  nx = minX;" : "")
        + (alignType === "center" ? "  if (w !== null) { nx = Math.round(centerX - (w / 2)); }" : "")
        + (alignType === "right" ? "  if (w !== null) { nx = maxX - w; }" : "")
        + (alignType === "top" ? "  ny = minY;" : "")
        + (alignType === "ctr" ? "  if (h !== null) { ny = Math.round(centerY - (h / 2)); }" : "")
        + (alignType === "bottom" ? "  if (h !== null) { ny = maxY - h; }" : "")
         + "  if (s.SetPosition) { s.SetPosition(nx, ny); }"
         + "}";
  }

  function buildDistributeScript(direction) {
    // direction: "h" | "v"
    return "var selection = Api.GetSelection ? Api.GetSelection() : null;"
         + "if (!selection) { return; }"
         + "var sel = selection.GetShapes ? selection.GetShapes() : [];"
         + "if (sel.length < 3) { return; }"
         + "var items = [];"
         + "var i, s, x, y, w, h;"
         + "for (i = 0; i < sel.length; i++) {"
         + "  s = sel[i];"
         + "  x = s.GetPosX ? s.GetPosX() : null;"
         + "  y = s.GetPosY ? s.GetPosY() : null;"
         + "  w = s.GetWidth ? s.GetWidth() : null;"
         + "  h = s.GetHeight ? s.GetHeight() : null;"
         + "  if (x === null || y === null || w === null || h === null) { continue; }"
         + "  items.push({ s: s, x: x, y: y, w: w, h: h });"
         + "}"
         + "if (items.length < 3) { return; }"
         + (direction === "h"
             ? "items.sort(function(a,b){ return a.x - b.x; });"
               + "var start = items[0].x;"
               + "var end = items[items.length - 1].x + items[items.length - 1].w;"
               + "var total = 0;"
               + "for (i = 0; i < items.length; i++) { total += items[i].w; }"
               + "var gap = (end - start - total) / (items.length - 1);"
               + "var pos = start;"
               + "for (i = 0; i < items.length; i++) {"
               + "  if (items[i].s.SetPosition) { items[i].s.SetPosition(Math.round(pos), items[i].y); }"
               + "  pos += items[i].w + gap;"
               + "}"
             : "items.sort(function(a,b){ return a.y - b.y; });"
               + "var start = items[0].y;"
               + "var end = items[items.length - 1].y + items[items.length - 1].h;"
               + "var total = 0;"
               + "for (i = 0; i < items.length; i++) { total += items[i].h; }"
               + "var gap = (end - start - total) / (items.length - 1);"
               + "var pos = start;"
               + "for (i = 0; i < items.length; i++) {"
               + "  if (items[i].s.SetPosition) { items[i].s.SetPosition(items[i].x, Math.round(pos)); }"
               + "  pos += items[i].h + gap;"
               + "}");
  }

  // ─── OnlyOffice Plugin lifecycle ───────────────────────────────────────────

  window.Asc.plugin.init = function () {
    updateUiFromSelection([]);

    if (window.Asc.plugin.attachEditorEvent) {
      window.Asc.plugin.attachEditorEvent("onSelectionChanged", refreshSelection);
    } else if (window.Asc.plugin.attachEvent) {
      window.Asc.plugin.attachEvent("onSelectionChanged", refreshSelection);
    }

    window.Asc.plugin.onSelectionChanged = refreshSelection;

    if (window.Asc.plugin.event_onSelectionChanged === undefined) {
      window.Asc.plugin.event_onSelectionChanged = refreshSelection;
    }

    // Fallback for builds where selection events are not always emitted.
    window.clearInterval(window.Asc.plugin._layoutSelectionWatchdog);
    window.Asc.plugin._layoutSelectionWatchdog = window.setInterval(refreshSelection, 700);

    // Request the current selection immediately so the panel is populated
    // as soon as the plugin opens.
    refreshSelection();
  };

  /**
   * Fetch selected objects from the editor via executeMethod and update the UI.
   */
  var inputFields = [elWidth, elHeight, elX, elY, elRotation];

  function anyInputFocused() {
    var active = document.activeElement;
    for (var i = 0; i < inputFields.length; i++) {
      if (inputFields[i] === active) { return true; }
    }
    return false;
  }

  function refreshSelection() {
    // Never overwrite values while the user is actively editing a field.
    if (anyInputFocused()) { return; }

    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }

    refreshTimer = window.setTimeout(function () {
      refreshTimer = null;

    if (refreshInFlight) {
      refreshQueued = true;
      return;
    }

    refreshInFlight = true;

    function finish() {
      refreshInFlight = false;
      if (refreshQueued) {
        refreshQueued = false;
        refreshSelection();
      }
    }

    fetchSelectedObjects(function (objects) {
      applySelection(objects);
      finish();
    });
    }, 80);
  }

  // ─── Event listeners ───────────────────────────────────────────────────────

  // Allow pressing Enter in any numeric field to apply immediately
  [elWidth, elHeight, elX, elY, elRotation].forEach(function (el) {
    el.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { applyLayoutValues(); }
    });
  });

  // Alignment buttons
  document.querySelectorAll("[data-align]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var alignKey = btn.getAttribute("data-align");
      var alignVal = ALIGN_MAP[alignKey];
      if (alignVal) {
        var script = buildAlignScript(alignVal);
        executeCommandAndRefresh(script);
      }
    });
  });

  // Distribute buttons
  document.querySelectorAll("[data-distribute]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var dir    = btn.getAttribute("data-distribute");
      var script = buildDistributeScript(dir);
      executeCommandAndRefresh(script);
    });
  });

}());
