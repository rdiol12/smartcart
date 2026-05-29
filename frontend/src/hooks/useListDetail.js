import { useState, useEffect, useReducer, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api";
import socket from "../socket";
import { useNotify } from "../context/NotifyContext";

// ─── List data reducer ───────────────────────────────────────────────────────
function listReducer(state, action) {
  switch (action.type) {
    case "LOADED":
      return {
        ...state,
        list: action.list,
        items: action.items,
        members: action.members,
        userRole: action.userRole,
        loading: false,
      };
    case "LOAD_ERROR":
      return { ...state, loading: false };
    case "ITEM_ADDED":
      return { ...state, items: [action.item, ...state.items] };
    case "ITEM_TOGGLED":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.itemId ? { ...i, is_checked: action.isChecked } : i,
        ),
      };
    case "ITEM_DELETED":
      return {
        ...state,
        items: state.items.filter((i) => i.id !== action.itemId),
      };
    case "NOTE_UPDATED":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.itemId
            ? {
                ...i,
                note: action.note,
                note_by: action.note_by,
                note_by_name: action.note_by_name,
              }
            : i,
        ),
      };
    case "ITEM_PAID":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.itemId
            ? {
                ...i,
                paid_by: action.paid_by,
                paid_by_name: action.paid_by_name,
                paid_at: action.paid_at,
              }
            : i,
        ),
      };
    case "ITEM_UNPAID":
      return {
        ...state,
        items: state.items.map((i) =>
          i.id === action.itemId
            ? { ...i, paid_by: null, paid_by_name: null, paid_at: null }
            : i,
        ),
      };
    default:
      return state;
  }
}

const initialListState = {
  list: null,
  items: [],
  members: [],
  userRole: "member",
  loading: true,
};

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useListDetail(listId) {
  const navigate = useNavigate();
  const notify = useNotify();

  const [listState, dispatch] = useReducer(listReducer, initialListState);

  // Modal visibility — one object, no 5 separate booleans
  const [modals, setModals] = useState({
    invite: false,
    saveTemplate: false,
    scanner: false,
    compare: false,
    children: false,
  });

  const openModal = useCallback(
    (name) => setModals((m) => ({ ...m, [name]: true })),
    [],
  );
  const closeModal = useCallback(
    (name) => setModals((m) => ({ ...m, [name]: false })),
    [],
  );

  // Add-item form
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [itemQty, setItemQty] = useState(1);
  const [requestMsg, setRequestMsg] = useState("");

  // Compare modal data
  const [compareData, setCompareData] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // Children modal data
  const [childrenList, setChildrenList] = useState([]);
  const [childrenLoading, setChildrenLoading] = useState(false);

  // ─── Data fetch + socket setup ─────────────────────────────────────────────
  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data } = await api.get(`/api/lists/${listId}/items`);
        dispatch({
          type: "LOADED",
          list: data.list,
          items: data.items,
          members: data.members,
          userRole: data.userRole,
        });
        // Join after data is loaded so socket events don't arrive
        // before initial state is populated.
        socket.emit("join_list", listId);
      } catch (err) {
        dispatch({ type: "LOAD_ERROR" });
        if (err.response?.status === 403) {
          navigate("/list");
        } else {
          notify(err.response?.data?.message || "שגיאה בטעינת הרשימה");
        }
      }
    };
    fetchData();

    // Define handlers
    const onReceiveItem = (item) => dispatch({ type: "ITEM_ADDED", item });
    const onItemStatusChanged = ({ itemId, isChecked }) =>
      dispatch({ type: "ITEM_TOGGLED", itemId, isChecked });
    const onItemDeleted = ({ itemId }) =>
      dispatch({ type: "ITEM_DELETED", itemId });
    const onNoteUpdated = (payload) =>
      dispatch({ type: "NOTE_UPDATED", ...payload });
    const onItemPaid = (payload) => dispatch({ type: "ITEM_PAID", ...payload });
    const onItemUnpaid = ({ itemId }) =>
      dispatch({ type: "ITEM_UNPAID", itemId });
    const onRemovedFromList = ({ listId: id }) => {
      if (String(id) === String(listId)) navigate("/list");
    };
    const onListDeleted = ({ listId: id }) => {
      if (String(id) === String(listId)) navigate("/list");
    };

    // Register socket listeners
    socket.on("receive_item", onReceiveItem);
    socket.on("item_status_changed", onItemStatusChanged);
    socket.on("item_deleted", onItemDeleted);
    socket.on("note_updated", onNoteUpdated);
    socket.on("item_paid", onItemPaid);
    socket.on("item_unpaid", onItemUnpaid);
    socket.on("removed_from_list", onRemovedFromList);
    socket.on("list_deleted", onListDeleted);

    return () => {
      socket.off("receive_item", onReceiveItem);
      socket.off("item_status_changed", onItemStatusChanged);
      socket.off("item_deleted", onItemDeleted);
      socket.off("note_updated", onNoteUpdated);
      socket.off("item_paid", onItemPaid);
      socket.off("item_unpaid", onItemUnpaid);
      socket.off("removed_from_list", onRemovedFromList);
      socket.off("list_deleted", onListDeleted);
    };
  }, [listId, navigate, notify]); // Dependencies are correct now

  // ─── Handlers ──────────────────────────────────────────────────────────────

  const clearSelectedProduct = useCallback(() => {
    setSelectedProduct(null);
    setItemQty(1);
  }, []);

  const handleCompare = useCallback(async () => {
    openModal("compare");
    setCompareLoading(true);
    try {
      const { data } = await api.get(`/api/lists/${listId}/compare`);
      setCompareData(data);
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בהשוואת מחירים");
    } finally {
      setCompareLoading(false);
    }
  }, [listId, notify, openModal]);

  const handleOpenChildren = useCallback(async () => {
    openModal("children");
    setChildrenLoading(true);
    try {
      const { data } = await api.get(`/api/family/lists/${listId}/children`);
      setChildrenList(data.children);
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בטעינת חשבונות הילדים");
    } finally {
      setChildrenLoading(false);
    }
  }, [listId, notify, openModal]);

  const handleToggleChild = useCallback(
    async (childId, currentlyMember) => {
      try {
        if (currentlyMember) {
          await api.delete(`/api/family/lists/${listId}/children/${childId}`);
        } else {
          await api.post(`/api/family/lists/${listId}/children/${childId}`);
        }
        setChildrenList((prev) =>
          prev.map((c) =>
            c.id === childId ? { ...c, is_member: !currentlyMember } : c,
          ),
        );
      } catch (err) {
        notify(err.response?.data?.message || "שגיאה בעדכון חשבון הילד");
      }
    },
    [listId, notify],
  );

  const handleDeleteList = useCallback(async () => {
    if (
      !confirm(
        `האם למחוק את הרשימה "${listState.list?.list_name}"? פעולה זו תמחק את כל הפריטים והחברים.`,
      )
    )
      return;
    try {
      await api.delete(`/api/lists/${listId}`);
      navigate("/list");
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה במחיקת הרשימה");
    }
  }, [listId, listState.list?.list_name, navigate, notify]);

  const handleLeaveList = useCallback(async () => {
    if (!confirm(`האם לעזוב את הרשימה "${listState.list?.list_name}"?`)) return;
    try {
      await api.post(`/api/lists/${listId}/leave`);
      navigate("/list");
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה ביציאה מהרשימה");
    }
  }, [listId, listState.list?.list_name, navigate, notify]);

  return {
    // list data
    ...listState,
    // modal state
    modals,
    openModal,
    closeModal,
    // add-item form
    selectedProduct,
    setSelectedProduct,
    itemQty,
    setItemQty,
    requestMsg,
    setRequestMsg,
    clearSelectedProduct,
    // compare
    compareData,
    compareLoading,
    // children
    childrenList,
    childrenLoading,
    // handlers
    handleCompare,
    handleOpenChildren,
    handleToggleChild,
    handleDeleteList,
    handleLeaveList,
  };
}
