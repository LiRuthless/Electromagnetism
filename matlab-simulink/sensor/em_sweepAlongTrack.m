function [sArr, U] = em_sweepAlongTrack(TD, P, e, psi, ds)
%EM_SWEEPALONGTRACK 全程扫描（数学模型.md §6.5，对应 sweepAlongTrack()）。
% 固定横向偏差 e（m，右正）与航向角 psi（rad，右正），车从 s=0 扫到全长，
% 逐点求 4 电感读数 U(s)（式 6.1，经由式 6.5–6.8 的位姿变换）。
% 输出：sArr (1xN) 弧长，U (4xN) 各电感读数（行序 L1,R1,L2,R2）。
if nargin < 5, ds = 0.01; end
sArr = 0:ds:TD.length;
N = numel(sArr);
U = zeros(4, N);
c = cos(psi); sn = sin(psi);
for i = 1:N
    [px, py, tx, ty] = em_pointAtLength(TD.path, sArr(i));
    % poseFrame（式 6.5/6.6）
    rTx = ty; rTy = -tx;                    % 切向右侧法向
    ox = px + e*rTx; oy = py + e*rTy;       % 车体原点
    fx = c*tx + sn*rTx;  fy = c*ty + sn*rTy;   % 车头方向 f̂
    rx = c*rTx - sn*tx;  ry = c*rTy - sn*ty;   % 车体右向 r̂'
    for j = 1:4
        sx = TD.sensMat(j,1); sy = TD.sensMat(j,2); h = TD.sensMat(j,3);
        wx = ox + sx*rx + sy*fx;            % 电感世界坐标（式 6.7）
        wy = oy + sx*ry + sy*fy;
        nx = TD.sensMat(j,4)*rx + TD.sensMat(j,5)*fx;   % 敏感轴世界向量（式 6.8）
        ny = TD.sensMat(j,4)*ry + TD.sensMat(j,5)*fy;
        nz = TD.sensMat(j,6);
        [bx, by, bz] = em_computeB(wx, wy, h, TD.wires, TD.mids, TD.dls, P.I);
        U(j,i) = P.k * abs(bx*nx + by*ny + bz*nz);
    end
end
end
