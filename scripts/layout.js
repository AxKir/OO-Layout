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
  var elBtnApply        = document.getElementById("btn-apply");

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

    if (elBtnApply) {
      elBtnApply.disabled = !hasSelection;
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
    window.Asc.plugin.executeMethod("GetSelectedObjects", [], function (objects) {
      var selected = normalizeSelectedObjects(objects);

      if (selected.length > 0 && hasUsableMetrics(selected[0])) {
        callback(selected);
        return;
      }

      // Fallback for editors/builds where GetSelectedObjects does not provide
      // drawing geometry: inspect selected drawings through DocBuilder.
      loadSelectedDrawings(function (drawings) {
        callback(normalizeSelectedObjects(drawings));
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
              ? "  s.SetRotAngle(" + newRot + ");"
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

    window.Asc.plugin.callCommand(new Function(script), true); // eslint-disable-line no-new-func
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
      return "var selection = Api.GetSelection ? Api.GetSelection() : null;"
        + "if (!selection) { return; }"
        + "var shapes = selection.GetShapes ? selection.GetShapes() : [];"
         + "var i, s;"
         + "for (i = 0; i < shapes.length; i++) {"
         + "  s = shapes[i];"
         + "  s.SetAlignObject(\"" + alignType + "\", true);" // true = relative to slide
         + "}";
  }

  function buildDistributeScript(direction) {
    // direction: "h" | "v"
    return "var selection = Api.GetSelection ? Api.GetSelection() : null;"
         + "if (!selection) { return; }"
         + "var sel = selection.GetShapes ? selection.GetShapes() : [];"
         + "if (sel.length < 2) { return; }"
         + (direction === "h"
             ? "sel[0].DistributeShapes(sel, true, false);"
             : "sel[0].DistributeShapes(sel, false, true);");
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

    // Request the current selection immediately so the panel is populated
    // as soon as the plugin opens.
    refreshSelection();
  };

  /**
   * Fetch selected objects from the editor via executeMethod and update the UI.
   */
  function refreshSelection() {
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

    loadSelectedDrawings(function (drawings) {
      var normalizedDrawings = normalizeSelectedObjects(drawings);
      applySelection(normalizedDrawings);
      finish();
    });
  }

  // ─── Event listeners ───────────────────────────────────────────────────────

  // Apply button
  elBtnApply.addEventListener("click", applyLayoutValues);

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
        window.Asc.plugin.callCommand(new Function(script), true); // eslint-disable-line no-new-func
      }
    });
  });

  // Distribute buttons
  document.querySelectorAll("[data-distribute]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var dir    = btn.getAttribute("data-distribute");
      var script = buildDistributeScript(dir);
      window.Asc.plugin.callCommand(new Function(script), true); // eslint-disable-line no-new-func
    });
  });

}());
