/**
 * Иконки: набор Iconoir (https://iconoir.com), обводка 2 (пожирнее стандартной 1.5).
 * `name` — имя Feather из старого приложения (`@expo/vector-icons`), чтобы переносить разметку без перевода имён;
 * значение — ближайшая по смыслу иконка Iconoir. `solid` — заливка (есть только у части иконок, см. SOLID).
 */
import type { ComponentType, SVGProps } from "react";
import {
  WarningCircle, WarningTriangle, Menu, AlignLeft, ArrowDown, ArrowDownCircle, ArrowLeft, ArrowRight, ArrowUp, ArrowUpCircle,
  ArrowUpRight, AtSign, Book, OpenBook, Bookmark, Calendar, Camera, Check, CheckCircle, CheckSquare, UndoAction,
  NavArrowDown, NavArrowLeft, NavArrowRight, NavArrowUp, ClipboardCheck, Clock, Cloud, Copy, Cpu, Database, Download,
  EditPencil, Edit, EyeClosed, Page, Filter, MediaVideo, Folder, Globe, ViewGrid, Hashtag, Heart, HomeSimpleDoor,
  MediaImage, InfoCircle, Key, ViewColumns3, List, Refresh, Lock, Mail, LogIn, LogOut, Maximize, Reduce, ChatBubble,
  ChatLines, MoreVert, Minus, MinusCircle, Box, Pause, DesignNib, Plus, PlusCircle, RefreshCircle, Repeat, Undo,
  FloppyDisk, Search, Send, Settings, Shield, Shuffle, FilterList, SmartphoneDevice, Square, Star, SunLight, Label,
  Trash, GraphUp, Text, Upload, User, Group, Xmark, XmarkCircle,
} from "iconoir-react";
import { Heart as HeartSolid, Star as StarSolid, Bookmark as BookmarkSolid, Book as BookSolid } from "iconoir-react/solid";

type IconCmp = ComponentType<SVGProps<SVGSVGElement> & { width?: number | string; height?: number | string }>;

const ICONS = {
  "alert-circle": WarningCircle,
  "alert-triangle": WarningTriangle,
  "align-justify": Menu,
  "align-left": AlignLeft,
  "arrow-down": ArrowDown,
  "arrow-down-circle": ArrowDownCircle,
  "arrow-left": ArrowLeft,
  "arrow-right": ArrowRight,
  "arrow-up": ArrowUp,
  "arrow-up-circle": ArrowUpCircle,
  "arrow-up-right": ArrowUpRight,
  "at-sign": AtSign,
  book: Book,
  "book-open": OpenBook,
  bookmark: Bookmark,
  calendar: Calendar,
  camera: Camera,
  check: Check,
  "check-circle": CheckCircle,
  "check-square": CheckSquare,
  "corner-up-left": UndoAction,
  "chevron-down": NavArrowDown,
  "chevron-left": NavArrowLeft,
  "chevron-right": NavArrowRight,
  "chevron-up": NavArrowUp,
  clipboard: ClipboardCheck,
  clock: Clock,
  cloud: Cloud,
  copy: Copy,
  cpu: Cpu,
  database: Database,
  download: Download,
  "edit-2": EditPencil,
  "edit-3": Edit,
  "eye-off": EyeClosed,
  "file-text": Page,
  filter: Filter,
  film: MediaVideo,
  folder: Folder,
  globe: Globe,
  grid: ViewGrid,
  hash: Hashtag,
  heart: Heart,
  home: HomeSimpleDoor,
  image: MediaImage,
  info: InfoCircle,
  key: Key,
  layout: ViewColumns3,
  list: List,
  loader: Refresh,
  lock: Lock,
  mail: Mail,
  "log-in": LogIn,
  "log-out": LogOut,
  maximize: Maximize,
  menu: Menu,
  "message-circle": ChatBubble,
  "message-square": ChatLines,
  "more-vertical": MoreVert,
  minimize: Reduce,
  minus: Minus,
  "minus-circle": MinusCircle,
  package: Box,
  pause: Pause,
  "pen-tool": DesignNib,
  plus: Plus,
  "plus-circle": PlusCircle,
  "refresh-ccw": RefreshCircle,
  "refresh-cw": Refresh,
  repeat: Repeat,
  "rotate-ccw": Undo,
  save: FloppyDisk,
  search: Search,
  send: Send,
  settings: Settings,
  shield: Shield,
  shuffle: Shuffle,
  sliders: FilterList,
  smartphone: SmartphoneDevice,
  square: Square,
  star: Star,
  sun: SunLight,
  tag: Label,
  "trash-2": Trash,
  "trending-up": GraphUp,
  type: Text,
  upload: Upload,
  user: User,
  users: Group,
  x: Xmark,
  "x-circle": XmarkCircle,
} satisfies Record<string, IconCmp>;

export type IconName = keyof typeof ICONS;

const SOLID: Partial<Record<IconName, IconCmp>> = {
  heart: HeartSolid,
  star: StarSolid,
  bookmark: BookmarkSolid,
  book: BookSolid,
};

export function Icon({
  name,
  size = 20,
  color = "currentColor",
  strokeWidth = 2,
  solid = false,
  className,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  solid?: boolean;
  className?: string;
}) {
  const Cmp: IconCmp = (solid && SOLID[name]) || ICONS[name];
  return (
    <Cmp
      width={size}
      height={size}
      color={color}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    />
  );
}
