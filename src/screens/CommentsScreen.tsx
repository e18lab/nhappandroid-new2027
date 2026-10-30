/**
 * Комментарии к книге — перенос `app/book/[id]/comments.tsx` (релиз 1.3.1).
 * Сверху «N всего» и сортировка (новые / старые), список показывается по 20 и догружается при прокрутке.
 * После входа сверху поле нового комментария (капча → PoW `comment`). Свой комментарий подсвечивается,
 * его можно удалить. Нажатие на автора открывает его профиль.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { deleteComment, getGalleryComments } from "../api/comments";
import type { Comment } from "../api/types";
import { CommentCard } from "../components/CommentCard";
import { CommentComposer } from "../components/CommentComposer";
import { useI18n } from "../i18n/I18nContext";
import { useMe } from "../lib/session";
import { FilterDropdown, Icon, LoadingSpinner, type SelectItem } from "../ui";

const PAGE_SIZE = 20;
type SortDir = "newest" | "oldest";

const toMs = (v: number | string | undefined) =>
  typeof v === "number" ? (v > 1e12 ? v : v * 1000) : Date.parse(String(v ?? "")) || 0;

export function CommentsScreen() {
  const { t } = useI18n();
  const galleryId = Number(useParams().id);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<SortDir>("newest");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [hidden, setHidden] = useState<Set<number>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const myId = useMe()?.id;

  const load = async () => {
    try {
      setComments(await getGalleryComments(galleryId));
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!galleryId) return;
    setLoading(true);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryId]);

  const sorted = useMemo(() => {
    const dir = sort === "newest" ? -1 : 1;
    return comments.filter((c) => !hidden.has(c.id)).sort((a, b) => (toMs(a.post_date) - toMs(b.post_date)) * dir);
  }, [comments, hidden, sort]);

  const changeSort = (next: SortDir) => {
    setSort(next);
    setVisible(PAGE_SIZE);
    scroller.current?.scrollTo({ top: 0 });
  };

  const onScroll = () => {
    const el = scroller.current;
    if (el && visible < sorted.length && el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 0.3) {
      setVisible((n) => Math.min(n + PAGE_SIZE, sorted.length));
    }
  };

  const remove = async (id: number) => {
    await deleteComment(id);
    setHidden((prev) => new Set(prev).add(id));
    void load();
  };

  const options: SelectItem[] = [
    { value: "newest", label: t("comments.sort.newest") },
    { value: "oldest", label: t("comments.sort.oldest") },
  ];

  return (
    <div className="screen-fill comments-screen">
      <div className="comments-sort">
        <span className="list-sort-count">{t("comments.totalCount", { count: sorted.length })}</span>
        <FilterDropdown
          value={sort}
          options={options}
          onChange={(v) => changeSort(v as SortDir)}
          minWidth={170}
          trigger={({ open, onPress }) => (
            <button type="button" className="list-sort-btn" onClick={onPress}>
              <Icon name="sliders" size={16} />
              <span>{t(sort === "newest" ? "comments.sort.newest" : "comments.sort.oldest")}</span>
              <Icon name={open ? "chevron-up" : "chevron-down"} size={18} />
            </button>
          )}
        />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div ref={scroller} className="screen-scroll comments-list" onScroll={onScroll}>
          {myId != null && (
            <CommentComposer
              galleryId={galleryId}
              onSubmitted={(c) => {
                setComments((prev) => [c, ...prev.filter((x) => x.id !== c.id)]);
                changeSort("newest");
              }}
            />
          )}
          {sorted.length === 0 ? (
            <div className="comments-empty">
              <Icon name="message-circle" size={48} />
              <span>{t("comments.empty")}</span>
            </div>
          ) : (
            sorted
              .slice(0, visible)
              .map((c) => (
                <CommentCard
                  key={c.id}
                  comment={c}
                  mine={myId != null && c.poster?.id === myId}
                  onDelete={myId != null ? remove : undefined}
                  onPressPoster={
                    c.poster?.id
                      ? () => navigate(`/profile/${c.poster.id}/${encodeURIComponent((c.poster.slug || c.poster.username || "user").toLowerCase())}`)
                      : undefined
                  }
                />
              ))
          )}
        </div>
      )}
    </div>
  );
}
