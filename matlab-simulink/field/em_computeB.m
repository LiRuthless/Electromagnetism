function [bx, by, bz] = em_computeB(px, py, pz, wires, mids, dls, I)
%EM_COMPUTEB 单点 B 矢量（数学模型.md §5.1/§5.2，对应 computeB()）。
%   圆弧段：毕奥-萨伐尔离散求和（式 5.1，奇异截断式 5.4）
%   直线段：闭式积分（式 5.2，精确）
% 输入 wires (Nwx4) [x0 y0 x1 y1]，mids/dls (Nax3)；返回 [Bx,By,Bz]，单位 Tesla。
% 本函数被 Simulink MATLAB Function 块调用，保持代码生成兼容（无 cell/struct）。
MU0 = 4*pi*1e-7;
R_MIN2 = 1e-6;
if nargin < 7, I = 0.1; end   % 本函数共 7 个参数：未传 I 时取默认 100 mA
coef = MU0*I/(4*pi);
bx = 0; by = 0; bz = 0;
na = size(dls, 1);
for i = 1:na
    rx = px - mids(i,1);
    ry = py - mids(i,2);
    rz = pz - mids(i,3);
    dlx = dls(i,1); dly = dls(i,2); dlz = dls(i,3);
    r2 = rx*rx + ry*ry + rz*rz;
    if r2 < R_MIN2, r2 = R_MIN2; end
    w = coef / (r2*sqrt(r2));
    bx = bx + (dly*rz - dlz*ry)*w;   % dl × r
    by = by + (dlz*rx - dlx*rz)*w;
    bz = bz + (dlx*ry - dly*rx)*w;
end
nw = size(wires, 1);
for i = 1:nw
    [wx, wy, wz] = em_wireSegB(px, py, pz, wires(i,1), wires(i,2), wires(i,3), wires(i,4), I);
    bx = bx + wx;
    by = by + wy;
    bz = bz + wz;
end
end
