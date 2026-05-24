import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import api from "../api";
import socket from "../socket";
import ListItemRow from "../components/ListItemRow";
import InviteLinkModal from "../components/InviteLinkModal";
import SaveAsTemplateModal from "../components/SaveAsTemplateModal";
import BarcodeScanner from "../components/BarcodeScanner";
import CompareModal from "../components/CompareModal";
import ChildrenModal from "../components/ChildrenModal";
import ProductSearchForList from "../components/ProductSearchForList";
import AddItemForm from "../components/AddItemForm";
import ListHeader from "../components/ListHeader";
import ItemsList from "../components/ItemsList";
import { useNotify } from "../context/NotifyContext";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";

const ListDetail = () => {
  const { listId } = useParams();
  const { isLinkedChild } = useContext(AuthContext);
  const navigate = useNavigate();
  const notify = useNotify();

  const [list, setList] = useState(null);
  const [items, setItems] = useState([]);
  const [members, setMembers] = useState([]);
  const [userRole, setUserRole] = useState("member");
  const [loading, setLoading] = useState(true);

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [itemQty, setItemQty] = useState(1);

  const [showInvite, setShowInvite] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  // Comparison modal state
  const [showCompare, setShowCompare] = useState(false);
  const [compareData, setCompareData] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // Child management modal state
  const [showChildrenModal, setShowChildrenModal] = useState(false);
  const [childrenList, setChildrenList] = useState([]);
  const [childrenLoading, setChildrenLoading] = useState(false);

  // Inline modals (price compare + child management) live in this file
  // rather than as standalone components, so we lock body scroll here.
  // The standalone modals (InviteLinkModal, SaveAsTemplateModal,
  // BarcodeScanner) handle their own locks via the same hook.
  useBodyScrollLock(showCompare || showChildrenModal);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const { data } = await api.get(`/api/lists/${listId}/items`);
        setList(data.list);
        setItems(data.items);
        setMembers(data.members);
        setUserRole(data.userRole);
      } catch (err) {
        if (err.response?.status === 403) {
          navigate("/list");
        } else {
          notify(err.response?.data?.message || "שגיאה בטעינת הרשימה");
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();

    socket.emit("join_list", listId);

    const onReceiveItem = (newItem) => {
      setItems((prev) => [newItem, ...prev]);
    };
    const onItemStatusChanged = ({ itemId, isChecked }) => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, is_checked: isChecked } : i,
        ),
      );
    };
    const onItemDeleted = ({ itemId }) => {
      setItems((prev) => prev.filter((i) => i.id !== itemId));
    };
    const onNoteUpdated = ({ itemId, note, note_by, note_by_name }) => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, note, note_by, note_by_name } : i,
        ),
      );
    };
    const onItemPaid = ({ itemId, paid_by, paid_by_name, paid_at }) => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId ? { ...i, paid_by, paid_by_name, paid_at } : i,
        ),
      );
    };
    const onItemUnpaid = ({ itemId }) => {
      setItems((prev) =>
        prev.map((i) =>
          i.id === itemId
            ? { ...i, paid_by: null, paid_by_name: null, paid_at: null }
            : i,
        ),
      );
    };

    socket.on("receive_item", onReceiveItem);
    socket.on("item_status_changed", onItemStatusChanged);
    socket.on("item_deleted", onItemDeleted);
    socket.on("note_updated", onNoteUpdated);
    socket.on("item_paid", onItemPaid);
    socket.on("item_unpaid", onItemUnpaid);

    return () => {
      socket.off("receive_item", onReceiveItem);
      socket.off("item_status_changed", onItemStatusChanged);
      socket.off("item_deleted", onItemDeleted);
      socket.off("note_updated", onNoteUpdated);
      socket.off("item_paid", onItemPaid);
      socket.off("item_unpaid", onItemUnpaid);
    };
  }, [listId, navigate, notify]);

  const [requestMsg, setRequestMsg] = useState("");

  const handleSelectProduct = (product) => {
    setSelectedProduct(product);
  };

  const clearSelectedProduct = () => {
    setSelectedProduct(null);
    setItemQty(1);
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    if (!selectedProduct) return;

    if (isLinkedChild) {
      try {
        await api.post("/api/family/kid-requests", {
          listId: parseInt(listId),
          itemName: selectedProduct.item_name,
          price: selectedProduct.price || null,
          storeName: selectedProduct.chain_name || null,
          quantity: itemQty,
          productId: selectedProduct.item_id || null,
        });
        setRequestMsg("הבקשה נשלחה לאישור ההורה");
        setTimeout(() => setRequestMsg(""), 3000);
      } catch (_err) {
        setRequestMsg("שגיאה בשליחת הבקשה");
        setTimeout(() => setRequestMsg(""), 3000);
      }
    } else {
      socket.emit("send_item", {
        listId: parseInt(listId),
        itemName: selectedProduct.item_name,
        price: selectedProduct.price || null,
        storeName: selectedProduct.chain_name || null,
        quantity: itemQty,
        addat: new Date(),
        updatedat: new Date(),
        productId: selectedProduct.item_id || null,
      });
    }

    setSelectedProduct(null);
    setItemQty(1);
  };

  const handleBarcodeResult = (product) => {
    setSelectedProduct({
      item_name: product.name,
      item_id: product.id || null,
      price: product.prices?.[0]?.price || null,
      chain_name: product.prices?.[0]?.chain_name || null,
    });
    setShowScanner(false);
  };

  const handleCompare = async () => {
    setShowCompare(true);
    setCompareLoading(true);
    try {
      const { data } = await api.get(`/api/lists/${listId}/compare`);
      setCompareData(data);
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בהשוואת מחירים");
    } finally {
      setCompareLoading(false);
    }
  };

  const handleOpenChildren = async () => {
    setShowChildrenModal(true);
    setChildrenLoading(true);
    try {
      const { data } = await api.get(`/api/family/lists/${listId}/children`);
      setChildrenList(data.children);
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה בטעינת חשבונות הילדים");
    } finally {
      setChildrenLoading(false);
    }
  };

  const handleToggleChild = async (childId, currentlyMember) => {
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
  };

  const handleDeleteList = async () => {
    if (
      !confirm(
        `האם למחוק את הרשימה "${list?.list_name}"? פעולה זו תמחק את כל הפריטים והחברים.`,
      )
    ) {
      return;
    }

    try {
      await api.delete(`/api/lists/${listId}`);
      navigate("/list");
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה במחיקת הרשימה");
    }
  };

  const handleLeaveList = async () => {
    if (!confirm(`האם לעזוב את הרשימה "${list?.list_name}"?`)) {
      return;
    }

    try {
      await api.post(`/api/lists/${listId}/leave`);
      navigate("/list");
    } catch (err) {
      notify(err.response?.data?.message || "שגיאה ביציאה מהרשימה");
    }
  };

  if (loading) {
    return (
      <div className="sc-loading-page">
        <div className="sc-spinner"></div>
      </div>
    );
  }

  const checkedCount = items.filter((i) => i.is_checked || i.paid_by).length;
  const basketTotal = items.reduce((sum, item) => {
    return (
      sum + (parseFloat(item.price) || 0) * (parseFloat(item.quantity) || 1)
    );
  }, 0);

  return (
    <div className="page-fade-in" dir="rtl">
      <div className="container py-4" style={{ maxWidth: "720px" }}>
        <ListHeader
          list={list}
          members={members}
          userRole={userRole}
          isLinkedChild={isLinkedChild}
          navigate={navigate}
          onOpenInvite={() => setShowInvite(true)}
          onOpenChildren={handleOpenChildren}
          onDeleteList={handleDeleteList}
          onLeaveList={handleLeaveList}
          onOpenSaveTemplate={() => setShowSaveTemplate(true)}
        />

        {/* Progress bar */}
        {items.length > 0 && (
          <div className="mb-3">
            <div
              className="d-flex justify-content-between mb-1"
              style={{ fontSize: "0.8rem", color: "var(--sc-text-muted)" }}
            >
              <span>
                {checkedCount} מתוך {items.length} הושלמו
              </span>
              <span>{Math.round((checkedCount / items.length) * 100)}%</span>
            </div>
            <div
              style={{
                height: "6px",
                background: "var(--sc-border)",
                borderRadius: "3px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${(checkedCount / items.length) * 100}%`,
                  background: "var(--sc-gradient-warm)",
                  borderRadius: "3px",
                  transition: "width 0.3s ease",
                }}
              />
            </div>
          </div>
        )}

        {/* Basket Total + Compare */}
        {items.length > 0 && (
          <div className="sc-card p-3 mb-3 d-flex justify-content-between align-items-center">
            <div>
              <span
                style={{ fontSize: "0.85rem", color: "var(--sc-text-muted)" }}
              >
                סה"כ סל:{" "}
              </span>
              <span
                className="fw-bold"
                style={{ fontSize: "1.1rem", color: "var(--sc-primary)" }}
              >
                ₪{basketTotal.toFixed(2)}
              </span>
            </div>
            <button
              className="sc-btn sc-btn-ghost"
              onClick={handleCompare}
              style={{ fontSize: "0.8rem", padding: "6px 14px" }}
            >
              <i className="bi bi-bar-chart me-1"></i> השוואת מחירים
            </button>
          </div>
        )}

        <AddItemForm
          selectedProduct={selectedProduct}
          itemQty={itemQty}
          setItemQty={setItemQty}
          setSelectedProduct={setSelectedProduct}
          isLinkedChild={isLinkedChild}
          onSubmit={handleAddItem}
          onOpenScanner={() => setShowScanner(true)}
          requestMsg={requestMsg}
          clearSelectedProduct={clearSelectedProduct}
        />

        <ItemsList items={items} listId={listId} />

        {/* Modals */}
        <InviteLinkModal
          show={showInvite}
          onClose={() => setShowInvite(false)}
          listId={listId}
        />
        <SaveAsTemplateModal
          show={showSaveTemplate}
          onClose={() => setShowSaveTemplate(false)}
          listId={listId}
        />
        {showScanner && (
          <BarcodeScanner
            onResult={handleBarcodeResult}
            onClose={() => setShowScanner(false)}
          />
        )}

        <CompareModal
          show={showCompare}
          onClose={() => setShowCompare(false)}
          data={compareData}
          loading={compareLoading}
        />
        <ChildrenModal
          show={showChildrenModal}
          onClose={() => setShowChildrenModal(false)}
          childrenList={childrenList}
          loading={childrenLoading}
          onToggleChild={handleToggleChild}
        />
      </div>
    </div>
  );
};

export default ListDetail;
