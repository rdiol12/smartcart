import React, { useContext } from "react";
import { useParams } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import socket from "../socket";
import ListItemRow from "../components/ListItemRow";
import InviteLinkModal from "../components/InviteLinkModal";
import SaveAsTemplateModal from "../components/SaveAsTemplateModal";
import BarcodeScanner from "../components/BarcodeScanner";
import CompareModal from "../components/CompareModal";
import ChildrenModal from "../components/ChildrenModal";
import AddItemForm from "../components/AddItemForm";
import ListHeader from "../components/ListHeader";
import ItemsList from "../components/ItemsList";
import { useBodyScrollLock } from "../hooks/useBodyScrollLock";
import { useListDetail } from "../hooks/useListDetail";
import api from "../api";

const ListDetail = () => {
  const { listId } = useParams();
  const { isLinkedChild } = useContext(AuthContext);

  const {
    list,
    items,
    members,
    userRole,
    loading,
    modals,
    openModal,
    closeModal,
    selectedProduct,
    setSelectedProduct,
    itemQty,
    setItemQty,
    requestMsg,
    setRequestMsg,
    clearSelectedProduct,
    compareData,
    compareLoading,
    childrenList,
    childrenLoading,
    handleCompare,
    handleOpenChildren,
    handleToggleChild,
    handleDeleteList,
    handleLeaveList,
  } = useListDetail(listId);

  useBodyScrollLock(modals.compare || modals.children);

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
        productId: selectedProduct.item_id || null,
      });
    }

    clearSelectedProduct();
  };

  const handleBarcodeResult = (product) => {
    setSelectedProduct({
      item_name: product.name,
      item_id: product.id || null,
      price: product.prices?.[0]?.price || null,
      chain_name: product.prices?.[0]?.chain_name || null,
    });
    closeModal("scanner");
  };

  if (loading) {
    return (
      <div className="sc-loading-page">
        <div className="sc-spinner"></div>
      </div>
    );
  }

  const checkedCount = items.filter((i) => i.is_checked || i.paid_by).length;
  const basketTotal = items.reduce(
    (sum, item) =>
      sum + (parseFloat(item.price) || 0) * (parseFloat(item.quantity) || 1),
    0,
  );

  return (
    <div className="page-fade-in" dir="rtl">
      <div className="container py-4" style={{ maxWidth: "720px" }}>
        <ListHeader
          list={list}
          members={members}
          userRole={userRole}
          isLinkedChild={isLinkedChild}
          onOpenInvite={() => openModal("invite")}
          onOpenChildren={handleOpenChildren}
          onDeleteList={handleDeleteList}
          onLeaveList={handleLeaveList}
          onOpenSaveTemplate={() => openModal("saveTemplate")}
        />

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
          onOpenScanner={() => openModal("scanner")}
          requestMsg={requestMsg}
          clearSelectedProduct={clearSelectedProduct}
        />

        <ItemsList items={items} listId={listId} />

        <InviteLinkModal
          show={modals.invite}
          onClose={() => closeModal("invite")}
          listId={listId}
        />
        <SaveAsTemplateModal
          show={modals.saveTemplate}
          onClose={() => closeModal("saveTemplate")}
          listId={listId}
        />
        {modals.scanner && (
          <BarcodeScanner
            onResult={handleBarcodeResult}
            onClose={() => closeModal("scanner")}
          />
        )}
        <CompareModal
          show={modals.compare}
          onClose={() => closeModal("compare")}
          data={compareData}
          loading={compareLoading}
        />
        <ChildrenModal
          show={modals.children}
          onClose={() => closeModal("children")}
          childrenList={childrenList}
          loading={childrenLoading}
          onToggleChild={handleToggleChild}
        />
      </div>
    </div>
  );
};

export default ListDetail;
