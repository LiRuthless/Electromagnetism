function tip = em_trackTip(segs)
%EM_TRACKTIP 段序列终点笔尖状态 [x,y,phi]（对应 trackTip()）。
tip = [0, 0, pi/2];
for i = 1:numel(segs)
    tip = em_advancePen(segs(i), tip);
end
end
