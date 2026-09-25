function U = ifcPlant(u)
%IFCPLANT 解释型 MATLAB Fcn 块包装：电感响应 Plant。
% 输入 u = [x; y; theta]（车体平面位姿）；输出 U = [L1;R1;L2;R2]（Vpp）。
% 赛道数据 TD 与参数 P 由 base 工作区读取（init 注入；换赛道/参数靠 init 刷新）。
% 公式：式 (6.7)(6.8) 位姿变换 → 式 (5.1)(5.2) 磁场 → 式 (6.1) U = k|B·n̂|。
TD = evalin('base','TD');
P  = evalin('base','P');
x = u(1); y = u(2); theta = u(3);
fx = cos(theta); fy = sin(theta);   % 车头方向 f̂
rx = sin(theta); ry = -cos(theta);  % 车体右向 r̂
U = zeros(4,1);
sm = P.sensMat;
for j = 1:4
    sx = sm(j,1); sy = sm(j,2); h = sm(j,3);
    px = x + sx*rx + sy*fx;
    py = y + sx*ry + sy*fy;
    nx = sm(j,4)*rx + sm(j,5)*fx;
    ny = sm(j,4)*ry + sm(j,5)*fy;
    nz = sm(j,6);
    [bx, by, bz] = em_computeB(px, py, h, TD.wires, TD.mids, TD.dls, P.I);
    U(j) = P.k * abs(bx*nx + by*ny + bz*nz);
end
end
