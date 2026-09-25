function dbg_diff()
%DBG_DIFF 诊断工具：em_track_sim.slx 与参考实现 em_simulateTracking 的
% 逐步差异定位——找出每个记录通道首次超过 1e-14 的步及上下文。
% 用于分析两处实现间的 ulp 级偏差在弯心振荡段的放大（见 build_em_track_sim 头注）。
% 用法：matlab -batch "cd('.../matlab-simulink'); addpath(genpath(pwd)); dbg_diff"
root = fileparts(fileparts(mfilename('fullpath')));
addpath(root, fullfile(root,'track_lib'), fullfile(root,'geom'), ...
    fullfile(root,'field'), fullfile(root,'sensor'), fullfile(root,'control'), ...
    fullfile(root,'blocks'), fullfile(root,'selfcheck'), fullfile(root,'demo'));

P = params();
P.Pcoef = -1;
P.initE = 0.03;
P.initPsi = 5*pi/180;
init('track_s_curve', P);
TD = evalin('base','TD');

R = em_simulateTracking(TD, P);
S = sim('em_track_sim');
v = S.simlog.signals.values;
t = S.simlog.time;
n = min(size(v,1), numel(R.t));
fprintf('步数：slx %d，ref %d，对照 %d 步\n', size(v,1), numel(R.t), n);

names = {'x','y','th','vL','vR','err'};
refs  = {R.x(:), R.y(:), R.theta(:), R.vL(:), R.vR(:), R.err(:)};
for c = 1:6
    a = v(1:n,c); b = refs{c}(1:n);
    d = abs(a-b);
    k0 = find(d > 1e-14, 1, 'first');
    if isempty(k0)
        fprintf('%-3s 全部 %d 步 <1e-14（bit 级一致）\n', names{c}, n);
    else
        fprintf('%-3s 首超 1e-14 @ 步 %d (t=%.3f)：slx=%.17g ref=%.17g |d|=%.2e，max|d|=%.2e\n', ...
            names{c}, k0, t(k0), a(k0), b(k0), d(k0), max(d));
    end
end
for j = 1:4
    a = v(1:n,6+j); b = R.U(j,1:n)';
    d = abs(a-b);
    k0 = find(d > 1e-14, 1, 'first');
    if isempty(k0)
        fprintf('U%d  全部 <1e-14\n', j);
    else
        fprintf('U%d 首超 1e-14 @ 步 %d：slx=%.17g ref=%.17g |d|=%.2e，max|d|=%.2e\n', ...
            j, k0, a(k0), b(k0), d(k0), max(d));
    end
end

% 若 err 先于位姿发散，打印首散步前后 err/vL/vR 对照
de = abs(v(1:n,6) - R.err(1:n)');
k0 = find(de > 1e-14, 1, 'first');
if ~isempty(k0)
    lo = max(1,k0-2); hi = min(n,k0+2);
    fprintf('\nerr 首散步 %d 上下文（步 | err_slx | err_ref | vL_slx | vL_ref | vR_slx | vR_ref）：\n', k0);
    for kk = lo:hi
        fprintf('%4d | %.16g %.16g | %.16g %.16g | %.16g %.16g\n', kk, ...
            v(kk,6), R.err(kk), v(kk,4), R.vL(kk), v(kk,5), R.vR(kk));
    end
end
end
