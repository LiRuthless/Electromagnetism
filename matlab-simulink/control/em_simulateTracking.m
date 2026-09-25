function R = em_simulateTracking(TD, P)
%EM_SIMULATETRACKING 循迹闭环仿真（纯 MATLAB 参考实现，对应 simulateTracking()）。
% 闭环信号流（§8.1）：位姿 → 电感世界坐标 → U（式 6.1）→ Err（式 8.1）
%   → PD（式 8.2）→ 指令轮速（式 8.3–8.5）→ 电机滞后（式 8.7）
%   → 半隐式欧拉积分（式 8.8/8.9）→ 终止判定（式 8.10）。
% 用途：em_track_sim.slx 的金标准对照——两者输出应逐步一致。
dt = P.dt;
maxSteps = ceil(P.stopTime / dt);
alpha = TD.alpha;

% 初始位姿：起点中线 + e/ψ 扰动（式 8.5）
[p0x, p0y, t0x, t0y] = em_pointAtLength(TD.path, 0);
x = p0x + P.initE*t0y;
y = p0y - P.initE*t0x;
th = atan2(t0y, t0x) + P.initPsi;

% 电机滞后状态（实际轮速）：起步以 v_base 直行（§8.4）
vL = P.vBase; vR = P.vBase;

t  = zeros(1, maxSteps);
xs = zeros(1, maxSteps);
ys = zeros(1, maxSteps);
ths = zeros(1, maxSteps);
vLs = zeros(1, maxSteps);
vRs = zeros(1, maxSteps);
errs = zeros(1, maxSteps);
Us = zeros(4, maxSteps);

prevErr = 0;
errRun = 0;
dist = 0;
finishIdx = -1;
status = 'maxSteps';
k = 0;

for k = 1:maxSteps
    % 车体架（carFrame）：forward=(cosθ,sinθ)，right=(sinθ,−cosθ)
    fx = cos(th); fy = sin(th);
    rx = sin(th); ry = -cos(th);
    U = zeros(4,1);
    for j = 1:4
        sx = TD.sensMat(j,1); sy = TD.sensMat(j,2); h = TD.sensMat(j,3);
        px = x + sx*rx + sy*fx;
        py = y + sx*ry + sy*fy;
        nx = TD.sensMat(j,4)*rx + TD.sensMat(j,5)*fx;
        ny = TD.sensMat(j,4)*ry + TD.sensMat(j,5)*fy;
        nz = TD.sensMat(j,6);
        [bx, by, bz] = em_computeB(px, py, h, TD.wires, TD.mids, TD.dls, P.I);
        U(j) = P.k * abs(bx*nx + by*ny + bz*nz);
    end

    % 误差（式 8.1；非法结果回退上一步，避免 NaN 发散）
    err = em_errDefault(U, P.A, P.B, P.C, P.Pcoef);
    if ~isfinite(err), err = prevErr; end

    % PD（式 8.2）+ 指令轮速（式 8.3–8.5）+ 电机一阶滞后（式 8.7）
    if k == 1, errRate = 0; else, errRate = (err - prevErr)/dt; end
    u = P.kp*err + P.kd*errRate;
    [vLc, vRc] = em_wheelSpeeds(u, P.vBase, P.vMax, P.w);
    vL = em_motorLag(vL, vLc, alpha);
    vR = em_motorLag(vR, vRc, alpha);

    % 记录（轮速为滞后后的实际值）
    t(k) = (k-1)*dt;
    xs(k) = x; ys(k) = y; ths(k) = th;
    vLs(k) = vL; vRs(k) = vR;
    errs(k) = err; Us(:,k) = U;

    % 终止条件（式 8.10 + 失控判停）
    if finishIdx < 0 && dist >= TD.length, finishIdx = k; end
    if abs(err) > P.errLimit
        errRun = errRun + 1;
        if errRun >= P.errLimitSteps
            status = 'lost';
            break
        end
    else
        errRun = 0;
    end
    if dist >= TD.finishDist
        status = 'finished';
        break
    end

    % 积分（实际轮速驱动运动学，式 8.8/8.9）
    prevErr = err;
    [x, y, th] = em_stepCar(x, y, th, vL, vR, P.W, dt);
    dist = dist + (vL + vR)/2*dt;
    if ~isfinite(x) || ~isfinite(y)
        status = 'lost';
        break
    end
end

R.status = status;
R.t = t(1:k);  R.x = xs(1:k);  R.y = ys(1:k);  R.theta = ths(1:k);
R.vL = vLs(1:k); R.vR = vRs(1:k); R.err = errs(1:k); R.U = Us(:,1:k);
R.timeS = k*dt;
R.distM = dist;
R.steps = k;
if finishIdx >= 0, R.finishIndex = finishIdx; else, R.finishIndex = k; end
end
