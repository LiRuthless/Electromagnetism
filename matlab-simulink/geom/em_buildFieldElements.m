function [wires, mids, dls] = em_buildFieldElements(segs, closed, maxDs)
%EM_BUILDFIELDELEMENTS 场计算专用离散化（数学模型.md §4.2，对应 buildFieldElements()）。
%   直线段不切碎——整条进 wires 走闭式积分（式 5.2，精确）；
%   仅圆弧段按 <=maxDs 离散为电流元（式 5.1，误差 <0.1%，自检 [9]）。
% 输出：
%   wires (Nw x 4) 每行 [x0 y0 x1 y1]（z=0 贴地）
%   mids  (Na x 3) 圆弧电流元中点，dls (Na x 3) 电流元矢量 dl
if nargin < 3, maxDs = 0.01; end
wires = zeros(0,4);
mids  = zeros(0,3);
dls   = zeros(0,3);
px = 0; py = 0; phi = pi/2;

for i = 1:numel(segs)
    seg = segs(i);
    if strcmp(seg.kind, 'line')
        L = max(seg.len, 1e-6);
        if isempty(seg.absAngle), phiSeg = phi; else, phiSeg = seg.absAngle; end
        dx = cos(phiSeg); dy = sin(phiSeg);
        wires(end+1,:) = [px, py, px + L*dx, py + L*dy]; %#ok<AGROW>
        px = px + L*dx; py = py + L*dy;
        if isempty(seg.exitAngle), phi = phiSeg; else, phi = seg.exitAngle; end
    else
        R = max(seg.R, 1e-6);
        alpha = abs(seg.angleDeg)*pi/180;
        arc = R*alpha;
        n = max(1, ceil(arc / maxDs));
        nx = sin(phi); ny = -cos(phi);          % 右侧法向
        if strcmp(seg.turn,'right'), sgn = 1; else, sgn = -1; end
        cx = px + sgn*R*nx; cy = py + sgn*R*ny;
        th0 = atan2(py - cy, px - cx);
        if strcmp(seg.turn,'right'), dTh = -alpha/n; else, dTh = alpha/n; end
        for j = 1:n
            th = th0 + (j-0.5)*dTh;
            mx = cx + R*cos(th); my = cy + R*sin(th);
            mids(end+1,:) = [mx, my, 0]; %#ok<AGROW>
            dls(end+1,:)  = [-R*sin(th)*dTh, R*cos(th)*dTh, 0]; %#ok<AGROW>
        end
        th1 = th0 + n*dTh;
        px = cx + R*cos(th1); py = cy + R*sin(th1);
        if strcmp(seg.turn,'right'), phi = th1 - pi/2; else, phi = th1 + pi/2; end
    end
end

% 闭环吸合段：终点 -> 起点（闭式积分直线段，式 4.3 由界面保证 <= CLOSE_SNAP）
if closed
    if hypot(px, py) > 1e-9
        wires(end+1,:) = [px, py, 0, 0]; %#ok<AGROW>
    end
end
end
