function [bx, by, bz] = em_wireSegB(px, py, pz, x0, y0, x1, y1, I)
%EM_WIRESEGB 有限长直线段闭式解（数学模型.md §5.2 式 5.2，对应 wireSegB()）。
% 电流元 a=(x0,y0,0) -> b=(x1,y1,0)，场点 P=(px,py,pz)。
% 矢量形式：B = μ₀I/(4π) · (t̂×r₁)/|ρ|² · (r₁·t̂/|r₁| − r₂·t̂/|r₂|)
% 场点在导线延长线上时按 R_MIN 截断（式 5.4）。
MU0 = 4*pi*1e-7;
R_MIN = 1e-3;
if nargin < 8, I = 0.1; end   % 本函数共 8 个参数：未传 I 时取默认 100 mA
lx = x1 - x0; ly = y1 - y0;
L = hypot(lx, ly);
if L < 1e-12
    bx = 0; by = 0; bz = 0;
    return
end
tx = lx/L; ty = ly/L;
r1x = px - x0; r1y = py - y0; r1z = pz;
r2x = px - x1; r2y = py - y1; r2z = pz;
u1 = r1x*tx + r1y*ty;            % r1·t̂
u2 = r2x*tx + r2y*ty;            % r2·t̂
n1 = max(sqrt(r1x*r1x + r1y*r1y + r1z*r1z), R_MIN);
n2 = max(sqrt(r2x*r2x + r2y*r2y + r2z*r2z), R_MIN);
d2 = r1x*r1x + r1y*r1y + r1z*r1z - u1*u1;   % |ρ|²
if d2 < R_MIN*R_MIN, d2 = R_MIN*R_MIN; end
factor = u1/n1 - u2/n2;
% t̂ × r₁（t̂ 的 z 分量为 0）
cx = ty*r1z;
cy = -tx*r1z;
cz = tx*r1y - ty*r1x;
coef = (MU0*I/(4*pi)) * (factor/d2);
bx = cx*coef;
by = cy*coef;
bz = cz*coef;
end
