function pen = em_advancePen(seg, pen)
%EM_ADVANCEPEN 单段几何推进（数学模型.md §4.1 式 4.1/4.2，对应 advancePen()）。
% pen = [x, y, phi]：当前终点位置与航向角（rad，从 +x 起算，初始 +90° 即 +y）。
if strcmp(seg.kind, 'line')
    L = max(seg.len, 1e-6);
    if isempty(seg.absAngle), phiSeg = pen(3); else, phiSeg = seg.absAngle; end
    pen(1) = pen(1) + L*cos(phiSeg);
    pen(2) = pen(2) + L*sin(phiSeg);
    if isempty(seg.exitAngle), pen(3) = phiSeg; else, pen(3) = seg.exitAngle; end
else
    R = max(seg.R, 1e-6);
    alpha = abs(seg.angleDeg)*pi/180;
    if strcmp(seg.turn, 'right'), sgn = 1; else, sgn = -1; end
    cx = pen(1) + sgn*R*sin(pen(3));
    cy = pen(2) - sgn*R*cos(pen(3));
    th0 = atan2(pen(2)-cy, pen(1)-cx);
    if strcmp(seg.turn, 'right'), th1 = th0 - alpha; else, th1 = th0 + alpha; end
    pen(1) = cx + R*cos(th1);
    pen(2) = cy + R*sin(th1);
    if strcmp(seg.turn, 'right'), pen(3) = th1 - pi/2; else, pen(3) = th1 + pi/2; end
end
end
