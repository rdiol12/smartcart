import React, { useState, useEffect, useContext } from "react";
import { AuthContext } from "../context/AuthContext";
import api from "../api";
import socket from "../socket";
import { useNotify } from "../context/NotifyContext";

const ItemComments = ({ itemId, listId }) => {
  const { user } = useContext(AuthContext);
  const notify = useNotify();
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchComments = async () => {
      try {
        const { data } = await api.get(`/api/lists/${listId}/items/${itemId}/comments`);
        setComments(data.comments);
      } catch (err) {
        notify(err.response?.data?.message || "שגיאה בטעינת ההערות");
      } finally {
        setLoading(false);
      }
    };
    fetchComments();

    const handleNewComment = (data) => {
      if (data.itemId === itemId) {
        setComments((prev) => [...prev, data.comment]);
      }
    };
    socket.on("receive_comment", handleNewComment);
    return () => socket.off("receive_comment", handleNewComment);
  }, [itemId, listId, notify]);

  const userComment = comments.find((c) => c.user_id === user.id);
  const hasCommented = !!userComment;

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newComment.trim()) return;
    if (hasCommented) {
      notify("כבר הוספת הערה לפריט זה");
      return;
    }
    // No userId here — the backend reads socket.user.id from the JWT
    // payload and ignores any client-supplied id. Including it was
    // wasteful and would mislead a future maintainer into thinking the
    // wire field is authoritative.
    socket.emit("add_comment", {
      itemId,
      listId,
      comment: newComment,
    });
    setNewComment("");
  };

  return (
    <div className="mt-2 border-top pt-2" dir="rtl">
      {loading ? (
        <small className="text-muted">טוען הערות...</small>
      ) : (
        <>
          {comments.map((c) => (
            <div key={c.id} className="mb-1">
              <small>
                <strong>{c.first_name}</strong>: {c.comment}
                {c.user_id === user.id && (
                  <span className="badge bg-primary ms-1" style={{ fontSize: "0.65rem" }}>שלך</span>
                )}
              </small>
            </div>
          ))}
          {comments.length === 0 && (
            <small className="text-muted">אין הערות עדיין</small>
          )}
        </>
      )}
      {!hasCommented && (
        <form onSubmit={handleSubmit} className="d-flex gap-1 mt-1">
          <input
            type="text"
            className="form-control form-control-sm"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="הוסף הערה..."
          />
          <button className="btn btn-sm btn-primary" type="submit">
            שלח
          </button>
        </form>
      )}
      {hasCommented && (
        <small className="text-muted d-block mt-1">כבר הוספת הערה לפריט זה</small>
      )}
    </div>
  );
};

export default ItemComments;
