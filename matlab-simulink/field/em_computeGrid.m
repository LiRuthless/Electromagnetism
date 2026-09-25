function [BX, BY, BZ, BM] = em_computeGrid(wires, mids, dls, I, x0, y0, nx, ny, dx, dy, h)
%EM_COMPUTEGRID 观测平面 z=h 网格批算（数学模型.md §5.5，对应 computeGridFull()）。
% 网格点 (x0+(ix-0.5)*dx, y0+(iy-0.5)*dy, h)，ix=1..nx，iy=1..ny。
% 输出 BX/BY/BZ/BM 均为 ny x nx 矩阵（行=iy 对应 y，列=ix 对应 x），单位 Tesla。
BX = zeros(ny, nx);
BY = zeros(ny, nx);
BZ = zeros(ny, nx);
BM = zeros(ny, nx);
for iy = 1:ny
    py = y0 + (iy-0.5)*dy;
    for ix = 1:nx
        px = x0 + (ix-0.5)*dx;
        [sx, sy, sz] = em_computeB(px, py, h, wires, mids, dls, I);
        BX(iy,ix) = sx;
        BY(iy,ix) = sy;
        BZ(iy,ix) = sz;
        BM(iy,ix) = sqrt(sx*sx + sy*sy + sz*sz);
    end
end
end
