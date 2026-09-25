function results = sc_tracking()
%SC_TRACKING 循迹闭环自检（对照《数学模型.md》§10.1 selfcheck:tracking 要点）：
%   (a) 电机一阶滞后阶跃响应 t=τ 时达 63.2%（式 8.7）；τ=0 瞬时跟随
%   (b) 直道初始扰动 e0=+50mm 收敛完赛（参考实现，Pcoef=-1 闭合负反馈）
%   (c) 闭环圆角矩形赛道一圈完赛（式 8.10，Pcoef=-1）
%   (d) em_track_sim.slx 与参考实现逐步对照（同一赛道与扰动，Pcoef=-1）
%
% 负反馈符号说明：默认布局下车右偏（e>0）时左感升/右感降，差比和 (L-R)/(L+R)>0，
% 与纠偏所需转向相反，故误差公式系数 P.Pcoef 必须取 -1 才构成负反馈
% （与 em-field-studio selfcheck-tracking.ts 的 P:-1 一致）。params 默认 +1 忠实文档，
% 闭环自检/演示一律显式置 -1。
results = {};

% ---------- (a) 电机滞后阶跃 ----------
dt = 0.005; tau = 0.03;
alpha = exp(-dt/tau);
v = 0;
for i = 1:round(tau/dt)
    v = em_motorLag(v, 1.0, alpha);
end
stepErr = abs(v - (1 - exp(-1)));
instOK = (em_motorLag(0, 1.5, 0) == 1.5);
results(end+1,:) = {'(a) 电机滞后阶跃 63.2% / tau=0 瞬时跟随', ...
    stepErr < 1e-12 && instOK, ...
    sprintf('t=tau 时 v=%.6f（期望 %.6f），tau=0 瞬时跟随 %d', v, 1-exp(-1), instOK)};

% ---------- (b) 直道收敛（参考实现） ----------
P = params();
P.Pcoef = -1;     % 负反馈（见头部说明）
P.initE = 0.05;   % +50 mm 右偏
TD = build_track_data('track_straight', P);
TD = local_finalize(TD, P);
R = em_simulateTracking(TD, P);
tailMask = R.t >= (R.timeS - 1.0);
tailErr = max(abs(R.err(tailMask)));
% 直道沿 +y，横向偏差即 x 坐标；收敛判据用 t∈[1,3.5]s 窗口 ±30 mm
% （对齐 TS selfcheck-tracking；末段为导线端点外区域，Err 失真属物理现象，不作判据）
latMask = R.t >= 1.0 & R.t <= 3.5;
maxAbsX = max(abs(R.x(latMask)));
passB = strcmp(R.status,'finished') && maxAbsX < 0.03;
results(end+1,:) = {'(b) 直道 e0=+50mm 收敛完赛（Pcoef=-1）', passB, ...
    sprintf('状态 %s，t∈[1,3.5]s 最大|x|=%.4f m（容差 30mm），完赛弧长 %.2f m（末段线外 Err=%.4f 仅参考）', ...
    R.status, maxAbsX, R.distM, tailErr)};

% ---------- (c) 闭环赛道一圈完赛 ----------
P = params();
P.Pcoef = -1;     % 负反馈
TD = build_track_data('track_loop_rounded', P);
TD = local_finalize(TD, P);
R = em_simulateTracking(TD, P);
passC = strcmp(R.status,'finished') && abs(R.distM - TD.length) < 0.05;
results(end+1,:) = {'(c) 闭环圆角矩形赛道一圈完赛（式 8.10，Pcoef=-1）', passC, ...
    sprintf('状态 %s，行驶 %.3f m / 单圈 %.3f m', R.status, R.distM, TD.length)};

% ---------- (d) Simulink 模型 vs 参考实现 ----------
if exist('em_track_sim.slx','file')
    P = params();
    P.Pcoef = -1;   % 负反馈
    P.initE = 0.03;
    P.initPsi = 5*pi/180;
    init('track_s_curve', P);
    TD = evalin('base','TD');
    Rref = em_simulateTracking(TD, P);
    simOut = sim('em_track_sim');
    v = simOut.simlog.signals.values;   % [x y th vL vR err U1..U4]
    n = min(size(v,1), numel(Rref.t));
    dx = max(abs(v(1:n,1) - Rref.x(1:n)'));
    dy = max(abs(v(1:n,2) - Rref.y(1:n)'));
    de = max(abs(v(1:n,6) - Rref.err(1:n)'));
    passD = dx < 1e-6 && dy < 1e-6 && de < 1e-4 && strcmp(Rref.status,'finished');
    results(end+1,:) = {'(d) em_track_sim 与参考实现逐步一致（S弯，Pcoef=-1）', passD, ...
        sprintf('max|Dx|=%.2e, max|Dy|=%.2e, max|DErr|=%.2e（容差 位置1e-6m/Err1e-4；弯心振荡段对 ulp 噪声敏感），参考状态 %s', ...
        dx, dy, de, Rref.status)};
else
    results(end+1,:) = {'(d) em_track_sim 对照', false, '模型未构建，先运行 build_all'};
end
end

function TD = local_finalize(TD, P)
% 补齐 init 中派生的字段（纯 MATLAB 路径不经过 base 工作区）
[p0x, p0y, t0x, t0y] = em_pointAtLength(TD.path, 0);
TD.x0 = p0x + P.initE*t0y;
TD.y0 = p0y - P.initE*t0x;
TD.theta0 = atan2(t0y, t0x) + P.initPsi;
if P.tauS > 0, TD.alpha = exp(-P.dt/P.tauS); else, TD.alpha = 0; end
if TD.closed, TD.finishDist = TD.length; else, TD.finishDist = TD.length + P.finishTol; end
TD.sensMat = P.sensMat;
end
