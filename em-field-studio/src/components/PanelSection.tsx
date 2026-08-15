/**
 * 面板可折叠分区（2026-08-15 UI 改造，程序设计说明.md §3.8）：
 * 统一的卡片式分区容器 —— 标题栏（可点击折叠/展开）+ 右侧可选操作位 + 内容区。
 * 折叠状态为会话内内存状态（不持久化），defaultOpen 仅在首次挂载时生效。
 *
 * 设计参考 Linear / Vercel 等深色工具：近黑表面 + 弱边框 + 单一强调色，
 * 用排版层级而非装饰区分信息。
 */
import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

export default function PanelSection({
  title,
  hint,
  actions,
  defaultOpen = true,
  children,
  className,
}: {
  title: string;
  /** 标题右侧的灰色小字说明（非交互） */
  hint?: string;
  /** 标题栏右侧操作区（按钮/开关等）；点击不触发展开折叠 */
  actions?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={`rounded-lg border border-slate-800 bg-slate-900/50 ${className ?? ''}`}
    >
      <div className="flex h-8 items-center gap-1 px-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
          onClick={() => setOpen((v) => !v)}
          title={open ? '点击折叠' : '点击展开'}
        >
          <ChevronRight
            size={13}
            className={`shrink-0 text-slate-500 transition-transform duration-150 ${
              open ? 'rotate-90' : ''
            }`}
          />
          <span className="truncate text-[11px] font-semibold tracking-wide text-slate-300">
            {title}
          </span>
          {hint && (
            <span className="ml-auto shrink-0 truncate pl-2 text-[10px] font-normal text-slate-500">
              {hint}
            </span>
          )}
        </button>
        {actions && (
          <div
            className="flex shrink-0 items-center gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>
      {open && <div className="px-2.5 pb-2.5">{children}</div>}
    </section>
  );
}
