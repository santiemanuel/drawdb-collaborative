import { memo, useMemo, useState, useRef, useEffect, useCallback } from "react";
import { Action, ObjectType, Tab, State } from "../../data/constants";
import {
  Input,
  Button,
  ButtonGroup,
  Popover,
  Divider,
} from "@douyinfe/semi-ui";
import ColorPicker from "../EditorSidePanel/ColorPicker";
import {
  IconEdit,
  IconDeleteStroked,
  IconLock,
  IconUnlock,
} from "@douyinfe/semi-icons";
import {
  useLayout,
  useUndoRedo,
  useSelect,
  useNotes,
  useSaveState,
  useTransform,
  useSettings,
} from "../../hooks";
import { useTranslation } from "react-i18next";
import { noteWidth, noteRadius, noteFold } from "../../data/constants";

export default memo(function Note({ data, onPointerDown }) {
  const [editField, setEditField] = useState({});
  const [hovered, setHovered] = useState(false);
  const resizeRef = useRef(null);
  const { layout } = useLayout();
  const { t } = useTranslation();
  const { setSaveState } = useSaveState();
  const { updateNote, deleteNote } = useNotes();
  const { setUndoStack, setRedoStack } = useUndoRedo();
  const { transform } = useTransform();
  const { settings } = useSettings();
  const {
    selectedElement,
    setSelectedElement,
    bulkSelectedElements,
    setBulkSelectedElements,
  } = useSelect();
  const initialColorRef = useRef(data.color);

  const latestResizeRef = useRef(null);
  latestResizeRef.current = { data, updateNote };
  const releaseResize = useCallback(() => {
    const resize = resizeRef.current;
    resizeRef.current = null;
    if (resize?.target.hasPointerCapture?.(resize.pointerId)) {
      resize.target.releasePointerCapture(resize.pointerId);
    }
    return resize;
  }, []);
  const cancelResize = useCallback(
    (event) => {
      const resize = resizeRef.current;
      if (
        !resize ||
        (event?.pointerId !== undefined && event.pointerId !== resize.pointerId)
      )
        return;
      releaseResize();
      const latest = latestResizeRef.current;
      latest.updateNote(latest.data.id, { width: resize.width, x: resize.x });
    },
    [releaseResize],
  );
  useEffect(() => {
    const cancel = () => cancelResize();
    window.addEventListener("drawdb:cancel-interaction", cancel);
    return () => {
      window.removeEventListener("drawdb:cancel-interaction", cancel);
      releaseResize();
    };
  }, [cancelResize, releaseResize]);
  const beginResize = (side) => (e) => {
    if (!e.isPrimary || resizeRef.current) return;
    e.stopPropagation();
    resizeRef.current = {
      side,
      width: data.width ?? noteWidth,
      x: data.x,
      clientX: e.clientX,
      pointerId: e.pointerId,
      target: e.currentTarget,
      zoom: transform?.zoom || 1,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const moveResize = (e) => {
    const resize = resizeRef.current;
    if (!resize || e.pointerId !== resize.pointerId) return;
    const delta = (e.clientX - resize.clientX) / resize.zoom;
    const width = Math.max(
      120,
      resize.width + (resize.side === "left" ? -delta : delta),
    );
    updateNote(data.id, {
      width,
      x: resize.side === "left" ? resize.x + resize.width - width : resize.x,
    });
  };
  const endResize = (e) => {
    if (!resizeRef.current || e.pointerId !== resizeRef.current.pointerId)
      return;
    const resize = releaseResize();
    e.stopPropagation();
    const finalWidth = data.width ?? noteWidth;
    if (finalWidth === resize.width && data.x === resize.x) return;
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.NOTE,
        nid: data.id,
        undo: { width: resize.width, x: resize.x },
        redo: { width: finalWidth, x: data.x },
        message: t("edit_note", { noteTitle: data.title, extra: "[width/x]" }),
      },
    ]);
    setRedoStack([]);
  };

  const handleColorPick = (color) => {
    setUndoStack((prev) => {
      let undoColor = initialColorRef.current;
      const lastColorChange = prev.findLast(
        (e) =>
          e.element === ObjectType.NOTE &&
          e.nid === data.id &&
          e.action === Action.EDIT &&
          e.redo?.color,
      );
      if (lastColorChange) {
        undoColor = lastColorChange.redo.color;
      }

      if (color === undoColor) return prev;

      const newStack = [
        ...prev,
        {
          action: Action.EDIT,
          element: ObjectType.NOTE,
          nid: data.id,
          undo: { color: undoColor },
          redo: { color: color },
          message: t("edit_note", {
            noteTitle: data.title,
            extra: "[color]",
          }),
        },
      ];
      return newStack;
    });
    setRedoStack([]);
  };

  const handleChange = (e) => {
    const textarea = document.getElementById(`note_${data.id}`);
    if (!textarea) return;
    textarea.style.height = "0";
    textarea.style.height = textarea.scrollHeight + "px";
    const newHeight = textarea.scrollHeight + 42;
    const updates = { content: e.target.value };
    if (newHeight !== data.height) {
      updates.height = newHeight;
    }
    updateNote(data.id, updates);
  };

  const handleBlur = (e) => {
    if (e.target.value === editField.content) return;
    const textarea = document.getElementById(`note_${data.id}`);
    textarea.style.height = "0";
    textarea.style.height = textarea.scrollHeight + "px";
    const newHeight = textarea.scrollHeight + 16 + 20 + 4;
    setUndoStack((prev) => [
      ...prev,
      {
        action: Action.EDIT,
        element: ObjectType.NOTE,
        nid: data.id,
        undo: editField,
        redo: { content: e.target.value, height: newHeight },
        message: t("edit_note", {
          noteTitle: e.target.value,
          extra: "[content]",
        }),
      },
    ]);
    setRedoStack([]);
  };

  const lockUnlockNote = (e) => {
    const locking = !data.locked;
    updateNote(data.id, { locked: locking });

    const lockNote = () => {
      setSelectedElement({
        ...selectedElement,
        element: ObjectType.NONE,
        id: -1,
        open: false,
      });
      setBulkSelectedElements((prev) =>
        prev.filter((el) => el.id !== data.id || el.type !== ObjectType.NOTE),
      );
    };

    const unlockNote = () => {
      const elementInBulk = {
        id: data.id,
        type: ObjectType.NOTE,
        initialCoords: { x: data.x, y: data.y },
        currentCoords: { x: data.x, y: data.y },
      };
      if (e.ctrlKey || e.metaKey) {
        setBulkSelectedElements((prev) => [...prev, elementInBulk]);
      } else {
        setBulkSelectedElements([elementInBulk]);
      }
      setSelectedElement((prev) => ({
        ...prev,
        element: ObjectType.NOTE,
        id: data.id,
        open: false,
      }));
    };

    if (locking) {
      lockNote();
    } else {
      unlockNote();
    }
  };

  const edit = () => {
    setSelectedElement((prev) => ({
      ...prev,
      ...(layout.sidebar && { currentTab: Tab.NOTES }),
      ...(!layout.sidebar && { element: ObjectType.NOTE }),
      id: data.id,
      open: true,
    }));

    if (layout.sidebar && selectedElement.currentTab === Tab.NOTES) {
      document
        .getElementById(`scroll_note_${data.id}`)
        .scrollIntoView({ behavior: "smooth" });
    }
  };

  const isSelected = useMemo(() => {
    return (
      (selectedElement.id === data.id &&
        selectedElement.element === ObjectType.NOTE) ||
      bulkSelectedElements.some(
        (e) => e.type === ObjectType.NOTE && e.id === data.id,
      )
    );
  }, [selectedElement, data, bulkSelectedElements]);

  const width = data.width ?? noteWidth;

  useEffect(() => {
    const textarea = document.getElementById(`note_${data.id}`);
    if (!textarea) return;

    textarea.style.height = "0";
    const scrollHeight = textarea.scrollHeight;
    textarea.style.height = scrollHeight + "px";
    const newHeight = scrollHeight + 42;

    if (layout.readOnly || newHeight === data.height) return;

    updateNote(data.id, { height: newHeight });
  }, [data.id, data.height, updateNote, layout.readOnly]);

  return (
    <g
      onPointerEnter={(e) => e.isPrimary && setHovered(true)}
      onPointerLeave={(e) => e.isPrimary && setHovered(false)}
      onPointerDown={(e) => {
        // Required for onPointerLeave to trigger when a touch pointer leaves
        // https://stackoverflow.com/a/70976017/1137077
        if (e.target.hasPointerCapture?.(e.pointerId)) {
          e.target.releasePointerCapture(e.pointerId);
        }
      }}
      onDoubleClick={edit}
    >
      <path
        d={`M${data.x + noteFold} ${data.y} L${data.x + width - noteRadius} ${
          data.y
        } A${noteRadius} ${noteRadius} 0 0 1 ${data.x + width} ${data.y + noteRadius} L${data.x + width} ${
          data.y + data.height - noteRadius
        } A${noteRadius} ${noteRadius} 0 0 1 ${data.x + width - noteRadius} ${data.y + data.height} L${
          data.x + noteRadius
        } ${data.y + data.height} A${noteRadius} ${noteRadius} 0 0 1 ${data.x} ${
          data.y + data.height - noteRadius
        } L${data.x} ${data.y + noteFold}`}
        fill={data.color}
        stroke={
          hovered
            ? "rgb(59 130 246)"
            : isSelected
              ? "rgb(59 130 246)"
              : "rgb(168 162 158)"
        }
        strokeDasharray={hovered ? 5 : 0}
        strokeLinejoin="round"
        strokeWidth="2"
      />
      <path
        d={`M${data.x} ${data.y + noteFold} L${data.x + noteFold - noteRadius} ${
          data.y + noteFold
        } A${noteRadius} ${noteRadius} 0 0 0 ${data.x + noteFold} ${data.y + noteFold - noteRadius} L${
          data.x + noteFold
        } ${data.y} L${data.x} ${data.y + noteFold} Z`}
        fill={data.color}
        stroke={
          hovered
            ? "rgb(59 130 246)"
            : isSelected
              ? "rgb(59 130 246)"
              : "rgb(168 162 158)"
        }
        strokeDasharray={hovered ? 5 : 0}
        strokeLinejoin="round"
        strokeWidth="2"
      />

      {!layout.readOnly && !data.locked && hovered && (
        <g style={{ pointerEvents: "none" }}>
          <circle
            cx={data.x}
            cy={data.y + data.height / 2}
            r={6}
            fill={settings.mode === "light" ? "white" : "rgb(28, 31, 35)"}
            stroke="#5891db"
            strokeWidth={2}
            opacity={1}
          />
          <circle
            cx={data.x + width}
            cy={data.y + data.height / 2}
            r={6}
            fill={settings.mode === "light" ? "white" : "rgb(28, 31, 35)"}
            stroke="#5891db"
            strokeWidth={2}
            opacity={1}
          />
        </g>
      )}
      {!layout.readOnly && !data.locked && (
        <rect
          x={data.x - 4}
          y={data.y + 8}
          width={8}
          height={Math.max(0, data.height - 16)}
          fill="transparent"
          stroke="transparent"
          style={{ cursor: "ew-resize" }}
          onPointerDown={beginResize("left")}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={cancelResize}
        />
      )}

      {!layout.readOnly && !data.locked && (
        <rect
          x={data.x + width - 4}
          y={data.y + 8}
          width={8}
          height={Math.max(0, data.height - 16)}
          fill="transparent"
          stroke="transparent"
          style={{ cursor: "ew-resize" }}
          onPointerDown={beginResize("right")}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={cancelResize}
        />
      )}
      <foreignObject
        x={data.x}
        y={data.y}
        width={width}
        height={data.height}
        onPointerDown={() => onPointerDown(data, ObjectType.NOTE)}
      >
        <div className="text-gray-900 select-none w-full h-full cursor-move px-3 py-2">
          <div className="flex justify-between gap-1 w-full">
            <label
              htmlFor={`note_${data.id}`}
              className="ms-5 overflow-hidden text-ellipsis"
            >
              {data.title}
            </label>
            {(hovered ||
              (selectedElement.element === ObjectType.NOTE &&
                selectedElement.id === data.id &&
                selectedElement.open &&
                !layout.sidebar)) && (
              <ButtonGroup
                type="tertiary"
                size="small"
                aria-label={t("note_actions")}
              >
                <Button
                  size="small"
                  type="tertiary"
                  icon={
                    data.locked ? (
                      <IconLock size="small" />
                    ) : (
                      <IconUnlock size="small" />
                    )
                  }
                  onClick={lockUnlockNote}
                  disabled={layout.readOnly}
                />
                <Popover
                  visible={
                    selectedElement.element === ObjectType.NOTE &&
                    selectedElement.id === data.id &&
                    selectedElement.open &&
                    !layout.sidebar
                  }
                  onClickOutSide={() => {
                    if (selectedElement.editFromToolbar) {
                      setSelectedElement((prev) => ({
                        ...prev,
                        editFromToolbar: false,
                      }));
                      return;
                    }
                    setSelectedElement((prev) => ({
                      ...prev,
                      open: false,
                    }));
                    setSaveState(State.SAVING);
                  }}
                  stopPropagation
                  content={
                    <div className="popover-theme">
                      <div className="font-semibold mb-2 ms-1">{t("edit")}</div>
                      <div className="w-[280px] flex items-center mb-2">
                        <Input
                          value={data.title}
                          placeholder={t("title")}
                          className="me-2"
                          readonly={layout.readOnly}
                          onChange={(value) =>
                            updateNote(data.id, { title: value })
                          }
                          onFocus={(e) =>
                            setEditField({ title: e.target.value })
                          }
                          onBlur={(e) => {
                            if (e.target.value === editField.title) return;
                            setUndoStack((prev) => [
                              ...prev,
                              {
                                action: Action.EDIT,
                                element: ObjectType.NOTE,
                                nid: data.id,
                                undo: editField,
                                redo: { title: e.target.value },
                                message: t("edit_note", {
                                  noteTitle: e.target.value,
                                  extra: "[title]",
                                }),
                              },
                            ]);
                            setRedoStack([]);
                          }}
                        />
                        <ColorPicker
                          usePopover={true}
                          readOnly={layout.readOnly}
                          value={data.color}
                          onChange={(color) => updateNote(data.id, { color })}
                          onColorPick={(color) => handleColorPick(color)}
                        />
                      </div>
                      <Divider />
                      <Button
                        icon={<IconDeleteStroked />}
                        type="danger"
                        theme="borderless"
                        block
                        disabled={layout.readOnly}
                        onClick={() => deleteNote(data.id, true)}
                      >
                        {t("delete")}
                      </Button>
                    </div>
                  }
                  trigger="custom"
                  position="rightTop"
                  showArrow
                >
                  <Button
                    size="small"
                    type="tertiary"
                    icon={<IconEdit size="small" />}
                    onClick={edit}
                  />
                </Popover>
              </ButtonGroup>
            )}
          </div>
          <textarea
            id={`note_${data.id}`}
            readOnly={layout.readOnly}
            value={data.content}
            onChange={handleChange}
            onFocus={(e) =>
              setEditField({
                content: e.target.value,
                height: data.height,
              })
            }
            onBlur={handleBlur}
            className="w-full resize-none outline-hidden overflow-y-hidden border-none select-none"
            style={{ backgroundColor: data.color }}
          />
        </div>
      </foreignObject>
    </g>
  );
});
