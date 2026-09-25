function results = sc_field()
%SC_FIELD 磁场与电感环节自检（对照《数学模型.md》§10.1 自检 [1][2][9][10]
% 及 em_field_check.slx 开环验证）。返回结果表；由 runAll 汇总打印。
results = {};

% ---------- [1] 4 m 长直道中心附近数值解 vs 无限长解析解（式 5.5） ----------
P = params();
TD = build_track_data('track_straight', P);
rhos = 0.02:0.01:0.20;
maxRel = 0;
for rho = rhos
    [bx,by,bz] = em_computeB(rho, 2.0, 0, TD.wires, TD.mids, TD.dls, P.I);
    Bnum = norm([bx,by,bz]);
    Bana = P.MU0*P.I/(2*pi*rho);
    maxRel = max(maxRel, abs(Bnum-Bana)/Bana);
end
results(end+1,:) = {'[1] 长直道数值解 vs 解析解 (rho=2~20cm)', maxRel < 0.02, ...
    sprintf('最大相对误差 %.3g%%（容差 2%%）', maxRel*100)};

% ---------- [2] B ∝ 1/ρ 衰减 ----------
[b1x,b1y,b1z] = em_computeB(0.05, 2.0, 0, TD.wires, TD.mids, TD.dls, P.I);
[b2x,b2y,b2z] = em_computeB(0.10, 2.0, 0, TD.wires, TD.mids, TD.dls, P.I);
ratio = norm([b1x,b1y,b1z]) / norm([b2x,b2y,b2z]);
results(end+1,:) = {'[2] B 随 1/rho 反比衰减 (0.05m/0.10m)', abs(ratio-2) < 0.02, ...
    sprintf('比值 %.4f（期望 ≈2）', ratio)};

% ---------- [9] 闭式解（式 5.2）vs 教材公式（式 5.3） ----------
% 线段 (0,0)->(1.5,0)，场点 (0.5, 0.3, 0.075)——注意垂直距离须含 z（3D）
[bx,by,bz] = em_wireSegB(0.5, 0.3, 0.075, 0, 0, 1.5, 0, P.I);
Bnum = norm([bx,by,bz]);
r1v = [0.5, 0.3, 0.075]; r2v = [-1.0, 0.3, 0.075];   % P−a, P−b（3D）
r1 = norm(r1v); r2 = norm(r2v);
u1 = r1v(1); u2 = r2v(1);                            % t̂ = (1,0,0)
d = sqrt(r1^2 - u1^2);
Bana = P.MU0*P.I/(4*pi*d) * (u1/r1 - u2/r2);
relErr9 = abs(Bnum-Bana)/Bana;
results(end+1,:) = {'[9] 直线段闭式解 vs 教材公式 (式 5.2/5.3)', relErr9 < 1e-12, ...
    sprintf('相对误差 %.3g（容差 1e-12，机器精度）', relErr9)};

% ---------- [10] 标定自洽 / 线性缩放 / cosθ 方向性 ----------
% 20 m 长直导线中部，电感横向贴线 3.25 mm、z=0、敏感轴 z（式 6.2–6.4）
[wires20, mids20, dls20] = em_buildFieldElements(seg_line(20), false, P.MAX_DS); %#ok<ASGLU>
k = em_calibK(P.VPP_ANCHOR, P.I);
dTouch = 0.00325;
[~,~,bz1] = em_computeB(dTouch, 10, 0, wires20, mids20, dls20, 0.1);
U1 = k*abs(bz1);
relK = abs(U1 - 6)/6;
% 电流 2× → 读数严格 2×
[~,~,bz2] = em_computeB(dTouch, 10, 0, wires20, mids20, dls20, 0.2);
ratio2 = (k*abs(bz2)) / U1;
% cosθ：敏感轴绕 y 转 60° → 读数 = 0.5×
n60 = [sin(pi/3), 0, cos(pi/3)];   % 与 z 轴夹角 60°
[bx3,by3,bz3] = em_computeB(dTouch, 10, 0, wires20, mids20, dls20, 0.1);
U60 = k*abs(bx3*n60(1) + by3*n60(2) + bz3*n60(3));
U0  = k*abs(bx3*0 + by3*0 + bz3*1);
ratioCos = U60 / U0;
pass10 = relK < 5e-4 && abs(ratio2-2) < 1e-6 && abs(ratioCos-0.5) < 1e-6;
results(end+1,:) = {'[10] 贴线锚点回收 6V / 2x 电流缩放 / cos60°=0.5', pass10, ...
    sprintf('回收 %.4f V（容差 0.05%%），缩放 %.6f，方向性 %.6f', U1, ratio2, ratioCos)};

% ---------- [slx] em_field_check 开环模型 vs 解析解 ----------
if exist('em_field_check.slx','file')
    init('track_straight');
    simOut = sim('em_field_check');
    v = simOut.elog.signals.values;   % [e, U1..U4]
    e = v(:,1); U = v(:,2:5);
    % 对照 L2/R2（横向感 Bx；L1/R1 感 By，在无限长直导线上 By≡0）
    maxRelSlx = 0;
    for j = [3 4]
        sx = P.sensMat(j,1); h = P.sensMat(j,3);
        wx = e + sx;                       % θ=π/2 时 right=(1,0)
        rho = sqrt(wx.^2 + h^2);
        BxA = P.MU0*P.I./(2*pi*rho) .* (h./rho);   % 解析 Bx = Bmag·(h/ρ)
        Uana = P.k * abs(BxA);
        mask = rho >= 0.02 & rho <= 0.20;
        relErr = abs(U(mask,j) - Uana(mask)) ./ Uana(mask);
        maxRelSlx = max(maxRelSlx, max(relErr));
    end
    results(end+1,:) = {'[slx] em_field_check 开环 U(e) vs 解析解', maxRelSlx < 0.02, ...
        sprintf('L2/R2 最大相对误差 %.3g%%（容差 2%%）', maxRelSlx*100)};
else
    results(end+1,:) = {'[slx] em_field_check 开环验证', false, '模型未构建，先运行 build_all'};
end
end
