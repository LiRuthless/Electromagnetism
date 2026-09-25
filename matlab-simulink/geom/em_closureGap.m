function g = em_closureGap(segs)
%EM_CLOSUREGAP 段序列终点到起点 (0,0) 的距离 m（式 4.3 的 g，对应 closureGapM()）。
if isempty(segs)
    g = inf;
    return
end
tip = em_trackTip(segs);
g = hypot(tip(1), tip(2));
end
