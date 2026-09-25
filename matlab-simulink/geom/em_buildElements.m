function [mids, dls] = em_buildElements(segs, closed, maxDs)
%EM_BUILD ELEMENTS 全量离散化（对应 buildElements()）：直线/圆弧都按 <=maxDs 切碎。
% 供中线采样（samplePath）与渲染用；场计算请用 em_buildFieldElements。
if nargin < 3, maxDs = 0.01; end
mids = zeros(0,3);
dls  = zeros(0,3);
px = 0; py = 0; phi = pi/2;

for i = 1:numel(segs)
    seg = segs(i);
    if strcmp(seg.kind, 'line')
        L = max(seg.len, 1e-6);
        n = max(1, ceil(L / maxDs));
        if isempty(seg.absAngle), phiSeg = phi; else, phiSeg = seg.absAngle; end
        dx = cos(phiSeg); dy = sin(phiSeg);
        dlx = dx*L/n; dly = dy*L/n;
        for j = 1:n
            t = (j-0.5)/n;
            mids(end+1,:) = [px + t*L*dx, py + t*L*dy, 0]; %#ok<AGROW>
            dls(end+1,:)  = [dlx, dly, 0]; %#ok<AGROW>
        end
        px = px + L*dx; py = py + L*dy;
        if isempty(seg.exitAngle), phi = phiSeg; else, phi = seg.exitAngle; end
    else
        R = max(seg.R, 1e-6);
        alpha = abs(seg.angleDeg)*pi/180;
        arc = R*alpha;
        n = max(1, ceil(arc / maxDs));
        nx = sin(phi); ny = -cos(phi);
        if strcmp(seg.turn,'right'), sgn = 1; else, sgn = -1; end
        cx = px + sgn*R*nx; cy = py + sgn*R*ny;
        th0 = atan2(py - cy, px - cx);
        if strcmp(seg.turn,'right'), dTh = -alpha/n; else, dTh = alpha/n; end
        for j = 1:n
            th = th0 + (j-0.5)*dTh;
            mids(end+1,:) = [cx + R*cos(th), cy + R*sin(th), 0]; %#ok<AGROW>
            dls(end+1,:)  = [-R*sin(th)*dTh, R*cos(th)*dTh, 0]; %#ok<AGROW>
        end
        th1 = th0 + n*dTh;
        px = cx + R*cos(th1); py = cy + R*sin(th1);
        if strcmp(seg.turn,'right'), phi = th1 - pi/2; else, phi = th1 + pi/2; end
    end
end

% 闭环吸合段：终点 -> 起点，同样按 <=maxDs 离散
if closed
    L = hypot(px, py);
    if L > 1e-9
        n = max(1, ceil(L / maxDs));
        dlx = (0-px)/n; dly = (0-py)/n;
        for j = 1:n
            t = (j-0.5)/n;
            mids(end+1,:) = [px + t*(0-px), py + t*(0-py), 0]; %#ok<AGROW>
            dls(end+1,:)  = [dlx, dly, 0]; %#ok<AGROW>
        end
    end
end
end
