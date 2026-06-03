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

      if (isSingleSelection) {
        setInputValue(elWidth, emuToMm(getNumericProperty(first, ["Width", "W", "width"], 0)));
        setInputValue(elHeight, emuToMm(getNumericProperty(first, ["Height", "H", "height"], 0)));
        setInputValue(elX, emuToMm(getNumericProperty(first, ["X", "Left", "PosX"], 0)));
        setInputValue(elY, emuToMm(getNumericProperty(first, ["Y", "Top", "PosY"], 0)));
        setInputValue(elRotation, getNumericProperty(first, ["Rot", "Rotation", "Angle"], 0));

        var width = getNumericProperty(first, ["Width", "W", "width"], 0);
        var height = getNumericProperty(first, ["Height", "H", "height"], 1);
        aspectRatio = height ? width / height : null;
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

  // ─── Apply size / position / rotation ──────────────────────────────────────

  /**
   * Builds a DocBuilder script that resizes and repositions the currently
   * selected shapes on the active slide.
   * All parameters are optional – empty inputs are skipped.
   */
  function buildApplyScript(newW, newH, newX, newY, newRot) {
    return "var pres    = Api.GetPresentation();"
         + "var slide   = pres.GetCurrentSlide();"
         + "var shapes  = slide.GetAllShapes();"
         + "var i, s;"
         + "for (i = 0; i < shapes.length; i++) {"
         + "  s = shapes[i];"
         + "  if (!s.IsSelected && !s.IsSelected()) { continue; }"
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
    return "var pres   = Api.GetPresentation();"
         + "var slide  = pres.GetCurrentSlide();"
         + "var shapes = slide.GetAllShapes();"
         + "var i, s;"
         + "for (i = 0; i < shapes.length; i++) {"
         + "  s = shapes[i];"
         + "  if (!s.IsSelected && !s.IsSelected()) { continue; }"
         + "  s.SetAlignObject(\"" + alignType + "\", true);" // true = relative to slide
         + "}";
  }

  function buildDistributeScript(direction) {
    // direction: "h" | "v"
    return "var pres   = Api.GetPresentation();"
         + "var slide  = pres.GetCurrentSlide();"
         + "var shapes = slide.GetAllShapes();"
         + "var sel = [];"
         + "var i;"
         + "for (i = 0; i < shapes.length; i++) {"
         + "  if (shapes[i].IsSelected && shapes[i].IsSelected()) {"
         + "    sel.push(shapes[i]);"
         + "  }"
         + "}"
         + "if (sel.length < 2) { return; }"
         + (direction === "h"
             ? "sel[0].DistributeShapes(sel, true, false);"
             : "sel[0].DistributeShapes(sel, false, true);");
  }

  // ─── OnlyOffice Plugin lifecycle ───────────────────────────────────────────

  window.Asc.plugin.init = function () {
    updateUiFromSelection([]);

    if (window.Asc.plugin.attachEvent) {
      window.Asc.plugin.attachEvent("onSelectionChanged", refreshSelection);
    }

    window.Asc.plugin.onSelectionChanged = refreshSelection;

    // Request the current selection immediately so the panel is populated
    // as soon as the plugin opens.
    refreshSelection();
  };

  /**
   * Fetch selected objects from the editor via executeMethod and update the UI.
   */
  function refreshSelection() {
    window.Asc.plugin.executeMethod("GetSelectedObjects", [], function (objects) {
      selectedObjects = objects || [];

      // Capture aspect ratio of first object for lock-aspect feature
      if (selectedObjects.length === 1) {
        var o = selectedObjects[0] || {};
        var w = getNumericProperty(o, ["Width", "W", "width"], 0);
        var h = getNumericProperty(o, ["Height", "H", "height"], 1);
        aspectRatio = h !== 0 ? w / h : null;
      } else {
        aspectRatio = null;
      }

      updateUiFromSelection(selectedObjects);
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
